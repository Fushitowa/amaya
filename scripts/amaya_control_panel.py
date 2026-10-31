#!/usr/bin/env python3
"""
Amaya's Drinks and Bites — One-Click Service Control Panel (v2.0)
Manages all four local services in one unified GUI:
  0. XAMPP MySQL Database (mysqld.exe)             -> 127.0.0.1:3306
  1. Backend API (cd api && npm run dev)           -> http://localhost:3001
  2. Customer Website (npm run dev:customer)       -> http://localhost:5173
  3. Staff POS / Admin Portal (npm run dev:portal) -> http://localhost:5174

Features:
- Dual-stack IPv4 (127.0.0.1) + IPv6 (::1) port detection and stale PID cleanup
- Built-in XAMPP MySQL (:3306) auto-detection and background startup
- Smart /api/health gatekeeper (prevents ECONNREFUSED console spam when MySQL is off)
- Clean Windows process tree termination (taskkill /F /T /PID)
"""

from __future__ import annotations

import datetime
import json
import os
import pathlib
import queue
import re
import secrets
import shutil
import socket
import subprocess
import threading
import time
import tkinter as tk
from tkinter import messagebox, ttk
import urllib.error
import urllib.request
import webbrowser

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent if SCRIPT_DIR.name in ("scripts", "tools") else SCRIPT_DIR
API_DIR = ROOT_DIR / "api"

XAMPP_MYSQL_BIN = pathlib.Path(r"C:\xampp\mysql\bin")
XAMPP_MYSQLD = XAMPP_MYSQL_BIN / "mysqld.exe"
XAMPP_MYSQLADMIN = XAMPP_MYSQL_BIN / "mysqladmin.exe"
XAMPP_MY_INI = XAMPP_MYSQL_BIN / "my.ini"

ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

SERVICES_CONFIG = [
    {
        "id": "mysql",
        "name": "0. XAMPP MySQL Database",
        "short_name": "MySQL DB",
        "cmd_display": "mysqld --defaults-file=C:\\xampp\\mysql\\bin\\my.ini",
        "kind": "mysql",
        "cwd": XAMPP_MYSQL_BIN if XAMPP_MYSQL_BIN.is_dir() else ROOT_DIR,
        "port": 3306,
        "url": "http://localhost/phpmyadmin",
        "open_label": "phpMyAdmin",
        "accent": "#FBBF24",
    },
    {
        "id": "api",
        "name": "1. Backend API (Express + MySQL)",
        "short_name": "Backend API",
        "cmd_display": "cd api && npm run dev",
        "kind": "npm",
        "npm_args": ["run", "dev"],
        "cwd": API_DIR,
        "port": 3001,
        "url": "http://localhost:3001/api/health",
        "open_label": "/api/health",
        "accent": "#EBC18F",
    },
    {
        "id": "customer",
        "name": "2. Customer Website (Public Menu)",
        "short_name": "Customer Web",
        "cmd_display": "npm run dev:customer",
        "kind": "npm",
        "npm_args": ["run", "dev:customer"],
        "cwd": ROOT_DIR,
        "port": 5173,
        "url": "http://localhost:5173",
        "open_label": "Open :5173",
        "accent": "#6EE7B7",
    },
    {
        "id": "portal",
        "name": "3. Staff POS & Admin Portal",
        "short_name": "POS & Admin",
        "cmd_display": "npm run dev:portal",
        "kind": "npm",
        "npm_args": ["run", "dev:portal"],
        "cwd": ROOT_DIR,
        "port": 5174,
        "url": "http://localhost:5174/login",
        "open_label": "Open POS :5174",
        "accent": "#93C5FD",
    },
]


def strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def resolve_npm_executable() -> str:
    if os.name == "nt":
        return shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"
    return shutil.which("npm") or "npm"


def is_port_open(port: int, timeout: float = 0.25) -> bool:
    """Check both IPv4 (127.0.0.1) and IPv6 (::1) loopback interfaces."""
    targets = [
        (socket.AF_INET, "127.0.0.1"),
        (socket.AF_INET6, "::1"),
    ]
    for family, host in targets:
        try:
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                if sock.connect_ex((host, port)) == 0:
                    return True
        except OSError:
            continue
    return False


def find_pids_on_port(port: int) -> list[int]:
    """
    Return all PIDs listening on the given TCP port across BOTH IPv4 (0.0.0.0 / 127.0.0.1)
    and IPv6 ([::] / [::1]) on Windows.
    Note: Do NOT pass '-p TCP' to netstat because Windows netstat filters out TCPv6 when '-p TCP' is used!
    """
    pids: set[int] = set()
    if os.name != "nt":
        return []
    try:
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=creationflags,
        )
        target_suffix = f":{port}"
        for line in result.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[0].upper().startswith("TCP"):
                local_addr = parts[1]
                state = parts[3].upper()
                pid_str = parts[4]
                if local_addr.endswith(target_suffix) and state == "LISTENING":
                    try:
                        pid = int(pid_str)
                        if pid > 0 and pid != os.getpid():
                            pids.add(pid)
                    except ValueError:
                        pass
    except Exception:
        pass
    return sorted(pids)


def kill_process_tree(pid: int) -> tuple[bool, str]:
    """Kill a process and its entire child tree on Windows using taskkill /F /T."""
    if pid <= 0:
        return False, "Invalid PID"
    try:
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            res = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                text=True,
                timeout=8,
                creationflags=creationflags,
            )
            output = (res.stdout or res.stderr).strip()
            return res.returncode == 0, output
        else:
            os.kill(pid, 15)
            return True, f"Sent SIGTERM to PID {pid}"
    except Exception as exc:
        return False, str(exc)


def check_api_health(timeout: float = 0.6) -> tuple[str, str]:
    """Query http://127.0.0.1:3001/api/health ONLY when MySQL (:3306) is reachable."""
    req = urllib.request.Request("http://127.0.0.1:3001/api/health", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            if resp.status == 200 and data.get("status") == "ok":
                return "ok", "DB Connected (200 OK)"
            return "warn", f"HTTP {resp.status}"
    except urllib.error.HTTPError as http_err:
        try:
            body = json.loads(http_err.read().decode("utf-8", errors="replace"))
            msg = body.get("message") or f"HTTP {http_err.code}"
        except Exception:
            msg = f"HTTP {http_err.code}"
        return "db_error", msg
    except Exception:
        return "down", "Offline"


class AmayaControlPanel:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Amaya's Drinks & Bites — POS, Web & MySQL Service Control Panel")
        self.root.geometry("1260x780")
        self.root.minsize(1040, 640)
        self.root.configure(bg="#1E1612")

        self.npm_exe = resolve_npm_executable()
        self.log_queue: queue.Queue[tuple[str, str, str]] = queue.Queue()
        self.is_closing = False
        self.auto_scroll_var = tk.BooleanVar(value=True)

        # Throttle /api/health HTTP requests so we never spam the Express console
        self._last_api_health_time: float = 0.0
        self._cached_api_health: tuple[str, str] = ("ok", "Listening (:3001)")

        # Runtime state per service
        self.processes: dict[str, subprocess.Popen | None] = {
            cfg["id"]: None for cfg in SERVICES_CONFIG
        }
        self.service_states: dict[str, str] = {
            cfg["id"]: "STOPPED" for cfg in SERVICES_CONFIG
        }
        self.stop_requested: dict[str, bool] = {
            cfg["id"]: False for cfg in SERVICES_CONFIG
        }

        # UI widget references
        self.card_widgets: dict[str, dict[str, tk.Widget]] = {}
        self.log_widgets: dict[str, tk.Text] = {}

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.enqueue_log(
            "system",
            "info",
            f"Amaya Control Panel v2.0 initialized at {ROOT_DIR}",
        )
        self.root.after(150, self._run_initial_preflight_summary)
        self.root.after(80, self._poll_log_queue)
        self.root.after(1200, self._poll_service_health)

    # ------------------------------------------------------------------
    # UI CONSTRUCTION
    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        header = tk.Frame(
            self.root,
            bg="#2A1E19",
            padx=18,
            pady=12,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        header.pack(fill=tk.X, padx=14, pady=(14, 8))

        title_frame = tk.Frame(header, bg="#2A1E19")
        title_frame.pack(side=tk.LEFT, fill=tk.Y)

        kicker = tk.Label(
            title_frame,
            text="AMAYA'S DRINKS & BITES • FULL-STACK + XAMPP MYSQL ORCHESTRATOR",
            font=("Segoe UI", 8, "bold"),
            fg="#EBC18F",
            bg="#2A1E19",
        )
        kicker.pack(anchor="w")

        title_lbl = tk.Label(
            title_frame,
            text="Service Control Panel (MySQL + API + Customer Web + Staff POS)",
            font=("Segoe UI", 14, "bold"),
            fg="#FFF8F0",
            bg="#2A1E19",
        )
        title_lbl.pack(anchor="w")

        btn_bar = tk.Frame(header, bg="#2A1E19")
        btn_bar.pack(side=tk.RIGHT)

        self._make_button(
            btn_bar,
            text="▶ Start All Services",
            bg="#8B5E3C",
            fg="#FFFFFF",
            command=self.start_all_services,
            padx=8,
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            btn_bar,
            text="⏹ Stop All",
            bg="#7F1D1D",
            fg="#FEE2E2",
            command=self.stop_all_services,
            padx=8,
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            btn_bar,
            text="🔄 Restart All",
            bg="#3B2A22",
            fg="#F5E6D3",
            command=self.restart_all_services,
            padx=8,
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            btn_bar,
            text="🧹 Free Ports (3001/5173/5174)",
            bg="#3B2A22",
            fg="#FCD34D",
            command=self.free_all_ports,
            padx=8,
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            btn_bar,
            text="🛠️ Setup / DB Migrate",
            bg="#3B2A22",
            fg="#93C5FD",
            command=self.run_setup_and_migrate,
            padx=6,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="👥 Accounts & Cashiers",
            bg="#3B2A22",
            fg="#A7F3D0",
            command=self.open_accounts_manager_dialog,
            padx=6,
        ).pack(side=tk.LEFT, padx=2)

        # Service Cards Grid (2x2 layout so all 4 services have plenty of room)
        cards_frame = tk.Frame(self.root, bg="#1E1612")
        cards_frame.pack(fill=tk.X, padx=14, pady=4)
        for col in range(2):
            cards_frame.columnconfigure(col, weight=1, uniform="service_cards")

        for idx, cfg in enumerate(SERVICES_CONFIG):
            row_idx = idx // 2
            col_idx = idx % 2
            self._build_service_card(cards_frame, cfg, row_idx, col_idx)

        # Catalog & Inventory Vault Bar (One-Click Archive & Clean / Recover)
        vault_bar = tk.Frame(
            self.root,
            bg="#2A1E19",
            padx=14,
            pady=8,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        vault_bar.pack(fill=tk.X, padx=14, pady=(4, 4))

        vault_left = tk.Frame(vault_bar, bg="#2A1E19")
        vault_left.pack(side=tk.LEFT, fill=tk.Y)

        tk.Label(
            vault_left,
            text="🗄️ INVENTORY & MENU CATALOG VAULT (ONE-CLICK ARCHIVE & CLEAN / RECOVER)",
            font=("Segoe UI", 8, "bold"),
            fg="#EBC18F",
            bg="#2A1E19",
        ).pack(anchor="w")

        self.vault_status_lbl = tk.Label(
            vault_left,
            text="Checking live catalog & archived vault snapshot...",
            font=("Consolas", 8),
            fg="#D6C4B4",
            bg="#2A1E19",
        )
        self.vault_status_lbl.pack(anchor="w", pady=(2, 0))

        vault_btns = tk.Frame(vault_bar, bg="#2A1E19")
        vault_btns.pack(side=tk.RIGHT)

        self._make_button(
            vault_btns,
            text="🗄️ Archive & Clean Inventory + Menu",
            bg="#9A3412",
            fg="#FFEDD5",
            command=self.archive_and_clean_catalog,
            padx=10,
            pady=4,
        ).pack(side=tk.LEFT, padx=4)

        self._make_button(
            vault_btns,
            text="♻️ Recover Archived Inventory + Menu",
            bg="#166534",
            fg="#DCFCE7",
            command=self.recover_archived_catalog,
            padx=10,
            pady=4,
        ).pack(side=tk.LEFT, padx=4)

        self._make_button(
            vault_btns,
            text="📂 Backups Folder",
            bg="#3B2A22",
            fg="#EBC18F",
            command=self.open_vault_backups_folder,
            padx=10,
            pady=4,
        ).pack(side=tk.LEFT, padx=(4, 0))

        # Bottom Console Area
        console_outer = tk.Frame(
            self.root,
            bg="#2A1E19",
            padx=12,
            pady=10,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        console_outer.pack(fill=tk.BOTH, expand=True, padx=14, pady=(6, 14))

        console_toolbar = tk.Frame(console_outer, bg="#2A1E19")
        console_toolbar.pack(fill=tk.X, pady=(0, 6))

        tk.Label(
            console_toolbar,
            text="LIVE TERMINAL OUTPUT & DIAGNOSTICS (IPv4 + IPv6 PORT GUARD ACTIVE)",
            font=("Segoe UI", 9, "bold"),
            fg="#EBC18F",
            bg="#2A1E19",
        ).pack(side=tk.LEFT)

        auto_chk = tk.Checkbutton(
            console_toolbar,
            text="Auto-Scroll",
            variable=self.auto_scroll_var,
            bg="#2A1E19",
            fg="#E5D5C5",
            selectcolor="#1E1612",
            activebackground="#2A1E19",
            activeforeground="#FFFFFF",
            font=("Segoe UI", 9),
        )
        auto_chk.pack(side=tk.RIGHT, padx=6)

        self._make_button(
            console_toolbar,
            text="Copy Current Log",
            bg="#3B2A22",
            fg="#E5D5C5",
            command=self.copy_current_log,
            padx=10,
            pady=3,
        ).pack(side=tk.RIGHT, padx=4)

        self._make_button(
            console_toolbar,
            text="Clear Current Log",
            bg="#3B2A22",
            fg="#E5D5C5",
            command=self.clear_current_log,
            padx=10,
            pady=3,
        ).pack(side=tk.RIGHT, padx=4)

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Amaya.TNotebook", background="#2A1E19", borderwidth=0)
        style.configure(
            "Amaya.TNotebook.Tab",
            background="#3B2A22",
            foreground="#D6C4B4",
            padding=(14, 6),
            font=("Segoe UI", 9, "bold"),
        )
        style.map(
            "Amaya.TNotebook.Tab",
            background=[("selected", "#8B5E3C")],
            foreground=[("selected", "#FFFFFF")],
        )

        self.notebook = ttk.Notebook(console_outer, style="Amaya.TNotebook")
        self.notebook.pack(fill=tk.BOTH, expand=True)

        tabs_spec = [
            ("all", "All Combined Logs"),
            ("mysql", "0. MySQL (:3306)"),
            ("api", "1. Backend API (:3001)"),
            ("customer", "2. Customer Web (:5173)"),
            ("portal", "3. Staff POS & Admin (:5174)"),
        ]

        for tab_id, tab_title in tabs_spec:
            tab_frame = tk.Frame(self.notebook, bg="#140F0C")
            self.notebook.add(tab_frame, text=tab_title)

            scrollbar = tk.Scrollbar(tab_frame, orient=tk.VERTICAL)
            text_widget = tk.Text(
                tab_frame,
                bg="#140F0C",
                fg="#E7DDD3",
                insertbackground="#FFFFFF",
                font=("Consolas", 10),
                wrap=tk.WORD,
                yscrollcommand=scrollbar.set,
                padx=10,
                pady=8,
                borderwidth=0,
                state=tk.DISABLED,
            )
            scrollbar.config(command=text_widget.yview)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            text_widget.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

            text_widget.tag_config("timestamp", foreground="#8A796D")
            text_widget.tag_config("prefix_mysql", foreground="#FBBF24", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_api", foreground="#EBC18F", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_customer", foreground="#6EE7B7", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_portal", foreground="#93C5FD", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_system", foreground="#C4B5FD", font=("Consolas", 10, "bold"))
            text_widget.tag_config("error", foreground="#FCA5A5")
            text_widget.tag_config("success", foreground="#86EFAC")
            text_widget.tag_config("warn", foreground="#FDE047")
            text_widget.tag_config("normal", foreground="#E7DDD3")

            self.log_widgets[tab_id] = text_widget

    def _build_service_card(self, parent: tk.Frame, cfg: dict, row_index: int, col_index: int) -> None:
        sid = cfg["id"]
        card = tk.Frame(
            parent,
            bg="#2A1E19",
            padx=14,
            pady=10,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        card.grid(row=row_index, column=col_index, sticky="nsew", padx=5, pady=4)

        top_row = tk.Frame(card, bg="#2A1E19")
        top_row.pack(fill=tk.X)

        title_lbl = tk.Label(
            top_row,
            text=cfg["name"],
            font=("Segoe UI", 10, "bold"),
            fg=cfg["accent"],
            bg="#2A1E19",
        )
        title_lbl.pack(side=tk.LEFT)

        status_badge = tk.Label(
            top_row,
            text="● STOPPED",
            font=("Segoe UI", 8, "bold"),
            fg="#9CA3AF",
            bg="#1E1612",
            padx=8,
            pady=2,
        )
        status_badge.pack(side=tk.RIGHT)

        meta_lbl = tk.Label(
            card,
            text=f"Port: :{cfg['port']}  |  PID: —  |  Cmd: {cfg['cmd_display']}",
            font=("Consolas", 8),
            fg="#C8B6A8",
            bg="#2A1E19",
        )
        meta_lbl.pack(anchor="w", pady=(4, 8))

        btn_row = tk.Frame(card, bg="#2A1E19")
        btn_row.pack(fill=tk.X)

        start_btn = self._make_button(
            btn_row,
            text="▶ Start",
            bg="#166534",
            fg="#DCFCE7",
            command=lambda s=sid: self.start_service(s),
            padx=10,
            pady=3,
        )
        start_btn.pack(side=tk.LEFT, padx=(0, 4))

        stop_btn = self._make_button(
            btn_row,
            text="⏹ Stop",
            bg="#7F1D1D",
            fg="#FEE2E2",
            command=lambda s=sid: self.stop_service(s),
            padx=10,
            pady=3,
        )
        stop_btn.pack(side=tk.LEFT, padx=4)

        restart_btn = self._make_button(
            btn_row,
            text="🔄 Restart",
            bg="#3B2A22",
            fg="#F5E6D3",
            command=lambda s=sid: self.restart_service(s),
            padx=10,
            pady=3,
        )
        restart_btn.pack(side=tk.LEFT, padx=4)

        open_btn = self._make_button(
            btn_row,
            text=f"🌐 {cfg['open_label']}",
            bg="#4B362B",
            fg="#EBC18F",
            command=lambda u=cfg["url"]: webbrowser.open(u),
            padx=10,
            pady=3,
        )
        open_btn.pack(side=tk.RIGHT)

        self.card_widgets[sid] = {
            "badge": status_badge,
            "meta": meta_lbl,
            "start_btn": start_btn,
            "stop_btn": stop_btn,
            "restart_btn": restart_btn,
        }

    def _make_button(
        self,
        parent: tk.Widget,
        text: str,
        bg: str,
        fg: str,
        command,
        padx: int = 12,
        pady: int = 6,
    ) -> tk.Button:
        return tk.Button(
            parent,
            text=text,
            bg=bg,
            fg=fg,
            activebackground="#A3704C",
            activeforeground="#FFFFFF",
            font=("Segoe UI", 9, "bold"),
            relief=tk.FLAT,
            cursor="hand2",
            padx=padx,
            pady=pady,
            command=command,
        )

    # ------------------------------------------------------------------
    # PRE-FLIGHT CHECKS & ENVIRONMENT AUTO-HEALING
    # ------------------------------------------------------------------
    def _run_initial_preflight_summary(self) -> None:
        root_nm = (ROOT_DIR / "node_modules").is_dir()
        api_nm = (API_DIR / "node_modules").is_dir()
        api_env = (API_DIR / ".env").is_file()
        xampp_ok = XAMPP_MYSQLD.is_file()
        mysql_running = is_port_open(3306)

        self.enqueue_log(
            "system",
            "info",
            f"Pre-flight -> XAMPP mysqld.exe: {'FOUND' if xampp_ok else 'NOT FOUND'} "
            f"(Port 3306: {'RUNNING' if mysql_running else 'STOPPED'}) | "
            f"Root node_modules: {'OK' if root_nm else 'MISSING'} | "
            f"API node_modules: {'OK' if api_nm else 'MISSING'} | "
            f"api/.env: {'OK' if api_env else 'MISSING'}",
        )
        self.refresh_vault_status()

    def _ensure_api_env_file(self) -> bool:
        env_path = API_DIR / ".env"
        example_path = API_DIR / ".env.example"

        if not env_path.is_file():
            if not example_path.is_file():
                self.enqueue_log("api", "error", "Missing api/.env and api/.env.example!")
                return False
            raw = example_path.read_text(encoding="utf-8")
            generated_secret = secrets.token_hex(32)
            raw = raw.replace(
                "JWT_SECRET=replace_with_a_random_secret_at_least_32_characters_long",
                f"JWT_SECRET={generated_secret}",
            )
            raw = raw.replace(
                "DB_PASSWORD=replace_with_your_local_mysql_password",
                "DB_PASSWORD=",
            )
            env_path.write_text(raw, encoding="utf-8")
            self.enqueue_log(
                "api",
                "success",
                "Created api/.env from .env.example with a 64-char JWT_SECRET.",
            )
            return True

        content = env_path.read_text(encoding="utf-8")
        if "replace_with_a_random_secret_at_least_32_characters_long" in content:
            generated_secret = secrets.token_hex(32)
            content = content.replace(
                "replace_with_a_random_secret_at_least_32_characters_long",
                generated_secret,
            )
            env_path.write_text(content, encoding="utf-8")
            self.enqueue_log(
                "api",
                "success",
                "Updated placeholder JWT_SECRET in api/.env with a 64-character secret.",
            )
        return True

    def _install_dependencies_if_missing(self, target_dir: pathlib.Path, service_id: str) -> bool:
        nm_path = target_dir / "node_modules"
        if nm_path.is_dir():
            return True

        self.enqueue_log(
            service_id,
            "warn",
            f"node_modules missing in {target_dir.name}. Running 'npm install' automatically...",
        )
        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            proc = subprocess.Popen(
                [self.npm_exe, "install"],
                cwd=str(target_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=creationflags,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                cleaned = strip_ansi(line).rstrip()
                if cleaned:
                    self.enqueue_log(service_id, "info", cleaned)
            proc.wait()
            if proc.returncode == 0:
                self.enqueue_log(service_id, "success", f"npm install completed in {target_dir.name}!")
                return True
            self.enqueue_log(service_id, "error", f"npm install failed in {target_dir.name} (code {proc.returncode}).")
            return False
        except Exception as exc:
            self.enqueue_log(service_id, "error", f"Failed to run npm install: {exc}")
            return False

    def run_setup_and_migrate(self) -> None:
        def _worker() -> None:
            self.enqueue_log("system", "info", "Starting environment setup & database migration...")
            self._ensure_api_env_file()
            if not is_port_open(3306):
                self.enqueue_log("mysql", "info", "MySQL (:3306) is offline. Starting XAMPP MySQL before migration...")
                self._start_service_worker("mysql")
                for _ in range(20):
                    if is_port_open(3306):
                        break
                    time.sleep(0.25)

            if not self._install_dependencies_if_missing(ROOT_DIR, "system"):
                return
            if not self._install_dependencies_if_missing(API_DIR, "api"):
                return

            self.enqueue_log("api", "info", "Running 'npm run db:migrate' in api/...")
            try:
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                proc = subprocess.Popen(
                    [self.npm_exe, "run", "db:migrate"],
                    cwd=str(API_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=creationflags,
                )
                assert proc.stdout is not None
                for line in proc.stdout:
                    cleaned = strip_ansi(line).rstrip()
                    if cleaned:
                        level = "error" if "error" in cleaned.lower() else "info"
                        self.enqueue_log("api", level, cleaned)
                proc.wait()
                if proc.returncode == 0:
                    self.enqueue_log("api", "success", "Database migration finished successfully!")
                    self.refresh_vault_status()
                else:
                    self.enqueue_log(
                        "api",
                        "error",
                        f"db:migrate exited with code {proc.returncode}.",
                    )
            except Exception as exc:
                self.enqueue_log("api", "error", f"Migration error: {exc}")

        threading.Thread(target=_worker, daemon=True).start()

    # ------------------------------------------------------------------
    # CATALOG & INVENTORY VAULT (ARCHIVE & CLEAN / RECOVER)
    # ------------------------------------------------------------------
    def _ensure_mysql_ready_for_vault(self) -> bool:
        if is_port_open(3306):
            return True
        self.enqueue_log("mysql", "info", "MySQL (:3306) is offline. Auto-starting XAMPP MySQL for Vault operation...")
        self._start_service_worker("mysql")
        for _ in range(24):
            if is_port_open(3306):
                return True
            time.sleep(0.25)
        return is_port_open(3306)

    def _apply_vault_status_payload(self, data: dict) -> None:
        if not hasattr(self, "vault_status_lbl"):
            return
        live_menu = data.get("liveMenu", 0)
        live_inv = data.get("liveInventory", 0)
        has_backup = data.get("hasBackup", False)
        b_menu = data.get("backupMenu", 0)
        b_inv = data.get("backupInventory", 0)
        b_ts = data.get("backupTimestamp") or ""
        if b_ts and "T" in b_ts:
            b_ts = b_ts.replace("T", " ").split(".")[0] + " UTC"

        if has_backup:
            backup_str = f"Ready ({b_menu} Products, {b_inv} Ingredients @ {b_ts})"
        else:
            backup_str = "None yet (Click 'Archive & Clean' to create snapshot)"

        text = f"Live DB: {live_menu} Menu Products, {live_inv} Inventory Ingredients  |  Archived Vault: {backup_str}"
        fg_color = "#86EFAC" if (live_menu > 0 or live_inv > 0) else "#FDE047"
        self.root.after(0, lambda: self.vault_status_lbl.configure(text=text, fg=fg_color))

    def refresh_vault_status(self) -> None:
        def _worker() -> None:
            backups_file = ROOT_DIR / "database" / "backups" / "catalog_vault_latest.json"
            if not is_port_open(3306):
                # Read local backup JSON even if MySQL is currently stopped
                b_menu, b_inv, has_b, b_ts = 0, 0, False, ""
                if backups_file.is_file():
                    try:
                        parsed = json.loads(backups_file.read_text(encoding="utf-8"))
                        has_b = True
                        b_menu = len(parsed.get("tables", {}).get("menu_products", []))
                        b_inv = len(parsed.get("tables", {}).get("inventory_items", []))
                        b_ts = parsed.get("createdAt", "")
                    except Exception:
                        pass
                backup_txt = f"Ready ({b_menu} Products, {b_inv} Ingredients)" if has_b else "None yet"
                msg = f"Live DB: (Start MySQL :3306 to inspect)  |  Archived Vault: {backup_txt}"
                if hasattr(self, "vault_status_lbl"):
                    self.root.after(0, lambda: self.vault_status_lbl.configure(text=msg, fg="#D6C4B4"))
                return

            try:
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                res = subprocess.run(
                    [node_exe, "src/catalog-vault.js", "status"],
                    cwd=str(API_DIR),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=10,
                    creationflags=creationflags,
                )
                for line in (res.stdout or "").splitlines():
                    if line.startswith("VAULT_STATUS_JSON:"):
                        payload = json.loads(line.split("VAULT_STATUS_JSON:", 1)[1])
                        self._apply_vault_status_payload(payload)
                        break
            except Exception as exc:
                self.enqueue_log("api", "warn", f"Vault status check skipped: {exc}")

        threading.Thread(target=_worker, daemon=True).start()

    def archive_and_clean_catalog(self) -> None:
        confirm = messagebox.askyesno(
            "Archive & Clean Inventory + Menu Catalog?",
            "This action will:\n\n"
            "1. ARCHIVE your entire current Inventory Management ingredients, stock levels, cups, and Menu Management products/recipes into a safe Vault Snapshot (database/backups/catalog_vault_latest.json).\n\n"
            "2. CLEAN SLATE your active Inventory Management and Menu Management database (0 products, 0 ingredients) so you can start completely fresh without duplicate-name conflicts.\n"
            "   (Your 9 Menu Categories, 12 Inventory Categories, Staff Accounts, and Orders are kept intact!)\n\n"
            "You can restore everything anytime with one click using '♻️ Recover Archived Inventory + Menu'.\n\n"
            "Proceed with Archive & Clean?",
        )
        if not confirm:
            return

        def _worker() -> None:
            self._ensure_api_env_file()
            if not self._ensure_mysql_ready_for_vault():
                self.enqueue_log("api", "error", "Cannot run Catalog Vault: MySQL (:3306) is not reachable.")
                self.root.after(
                    0,
                    lambda: messagebox.showerror(
                        "MySQL Offline",
                        "Could not connect to MySQL on port 3306. Please start XAMPP MySQL first.",
                    ),
                )
                return

            self.enqueue_log("api", "info", "Running Catalog Vault: 'node src/catalog-vault.js archive-clean'...")
            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                proc = subprocess.Popen(
                    [node_exe, "src/catalog-vault.js", "archive-clean"],
                    cwd=str(API_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=creationflags,
                )
                assert proc.stdout is not None
                last_payload: dict | None = None
                for raw_line in proc.stdout:
                    cleaned = strip_ansi(raw_line).rstrip()
                    if not cleaned:
                        continue
                    if cleaned.startswith("VAULT_STATUS_JSON:"):
                        try:
                            last_payload = json.loads(cleaned.split("VAULT_STATUS_JSON:", 1)[1])
                            self._apply_vault_status_payload(last_payload)
                        except Exception:
                            pass
                        continue
                    level = "error" if "error" in cleaned.lower() else "success" if "clean slate" in cleaned.lower() else "info"
                    self.enqueue_log("api", level, cleaned)

                proc.wait()
                if proc.returncode == 0 and last_payload:
                    if last_payload.get("alreadyClean"):
                        self.root.after(
                            0,
                            lambda: messagebox.showinfo(
                                "Catalog Already Clean (Backup Preserved)",
                                f"Your live Inventory & Menu database is already clean (0 Products, 0 Ingredients).\n\n"
                                f"Safety Guard preserved your previous Vault backup ({last_payload.get('backupMenu', 0)} Products, "
                                f"{last_payload.get('backupInventory', 0)} Ingredients) so it was not overwritten with zeros!",
                            ),
                        )
                    else:
                        self.root.after(
                            0,
                            lambda: messagebox.showinfo(
                                "Archive & Clean Complete!",
                                f"Successfully archived {last_payload.get('backupMenu', 0)} Menu Products and "
                                f"{last_payload.get('backupInventory', 0)} Inventory Ingredients to the Vault!\n\n"
                                f"Live Database is now a 100% clean slate:\n"
                                f"• Active Menu Products: 0\n"
                                f"• Active Inventory Ingredients: 0\n\n"
                                f"Refresh your Admin Portal (:5174) to view the clean database, or click '♻️ Recover Archived Inventory + Menu' anytime to restore.",
                            ),
                        )
                else:
                    self.root.after(
                        0,
                        lambda: messagebox.showerror(
                            "Archive & Clean Failed",
                            "Catalog Vault archive-clean encountered an error. Check the Live Terminal Output below for details.",
                        ),
                    )
            except Exception as exc:
                self.enqueue_log("api", "error", f"Catalog Vault error: {exc}")

        threading.Thread(target=_worker, daemon=True).start()

    def recover_archived_catalog(self) -> None:
        backups_file = ROOT_DIR / "database" / "backups" / "catalog_vault_latest.json"
        if not backups_file.is_file():
            messagebox.showwarning(
                "No Archived Snapshot Found",
                f"No archived catalog snapshot was found at:\n{backups_file}\n\n"
                "Click '🗄️ Archive & Clean Inventory + Menu' first to create a Vault snapshot.",
            )
            return

        b_menu, b_inv, b_ts = 0, 0, "Unknown"
        try:
            parsed = json.loads(backups_file.read_text(encoding="utf-8"))
            b_menu = len(parsed.get("tables", {}).get("menu_products", []))
            b_inv = len(parsed.get("tables", {}).get("inventory_items", []))
            b_ts = parsed.get("createdAt", "Unknown")
        except Exception:
            pass

        confirm = messagebox.askyesno(
            "Recover Archived Inventory + Menu?",
            f"Restore the archived Vault snapshot into the live MySQL database?\n\n"
            f"• Snapshot Timestamp: {b_ts}\n"
            f"• Menu Products to Restore: {b_menu}\n"
            f"• Inventory Ingredients to Restore: {b_inv}\n\n"
            f"(Any items currently in the live database will first be saved to a pre_recovery safety file in database/backups/.)\n\n"
            f"Proceed with Full Recovery?",
        )
        if not confirm:
            return

        def _worker() -> None:
            self._ensure_api_env_file()
            if not self._ensure_mysql_ready_for_vault():
                self.enqueue_log("api", "error", "Cannot run Catalog Vault recovery: MySQL (:3306) is offline.")
                self.root.after(
                    0,
                    lambda: messagebox.showerror(
                        "MySQL Offline",
                        "Could not connect to MySQL on port 3306. Please start XAMPP MySQL first.",
                    ),
                )
                return

            self.enqueue_log("api", "info", "Running Catalog Vault: 'node src/catalog-vault.js recover'...")
            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                proc = subprocess.Popen(
                    [node_exe, "src/catalog-vault.js", "recover"],
                    cwd=str(API_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=creationflags,
                )
                assert proc.stdout is not None
                last_payload: dict | None = None
                for raw_line in proc.stdout:
                    cleaned = strip_ansi(raw_line).rstrip()
                    if not cleaned:
                        continue
                    if cleaned.startswith("VAULT_STATUS_JSON:"):
                        try:
                            last_payload = json.loads(cleaned.split("VAULT_STATUS_JSON:", 1)[1])
                            self._apply_vault_status_payload(last_payload)
                        except Exception:
                            pass
                        continue
                    level = "error" if "error" in cleaned.lower() else "success" if "recovery complete" in cleaned.lower() else "info"
                    self.enqueue_log("api", level, cleaned)

                proc.wait()
                if proc.returncode == 0 and last_payload:
                    self.root.after(
                        0,
                        lambda: messagebox.showinfo(
                            "Catalog Recovery Complete!",
                            f"Successfully restored your archived catalog back into the live MySQL database!\n\n"
                            f"• Restored Menu Products: {last_payload.get('liveMenu', 0)}\n"
                            f"• Restored Inventory Ingredients: {last_payload.get('liveInventory', 0)}\n\n"
                            f"Refresh your Admin Portal (:5174) or Customer Website (:5173) to see all restored items and recipes.",
                        ),
                    )
                else:
                    self.root.after(
                        0,
                        lambda: messagebox.showerror(
                            "Recovery Failed",
                            "Catalog Vault recovery encountered an error. Check the Live Terminal Output below for details.",
                        ),
                    )
            except Exception as exc:
                self.enqueue_log("api", "error", f"Catalog Vault recovery error: {exc}")

        threading.Thread(target=_worker, daemon=True).start()

    def open_vault_backups_folder(self) -> None:
        backups_dir = ROOT_DIR / "database" / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)
        try:
            if os.name == "nt":
                os.startfile(str(backups_dir))
            else:
                webbrowser.open(backups_dir.as_uri())
            self.enqueue_log("system", "info", f"Opened Vault backups directory: {backups_dir}")
        except Exception as exc:
            self.enqueue_log("system", "error", f"Could not open backups folder: {exc}")

    # ------------------------------------------------------------------
    # ACCOUNTS & CASHIER CREDENTIALS MANAGER DIALOG
    # ------------------------------------------------------------------
    def open_accounts_manager_dialog(self) -> None:
        dialog = tk.Toplevel(self.root)
        dialog.title("Amaya — Team Accounts & Cashier Passwords")
        dialog.geometry("780x640")
        dialog.minsize(700, 520)
        dialog.configure(bg="#1E1612")
        dialog.transient(self.root)

        # Header Frame
        hdr = tk.Frame(dialog, bg="#2A1E19", padx=16, pady=12)
        hdr.pack(fill=tk.X)
        tk.Label(
            hdr,
            text="👥 TEAM ACCOUNTS & CASHIER CREDENTIALS",
            font=("Segoe UI", 11, "bold"),
            fg="#EBC18F",
            bg="#2A1E19",
        ).pack(anchor="w")
        tk.Label(
            hdr,
            text="Owner signs in with 'admin'. Counter staff signs in with 'staff' + their unique cashier password.",
            font=("Segoe UI", 8),
            fg="#D6C4B4",
            bg="#2A1E19",
        ).pack(anchor="w", pady=(2, 0))

        # Status / Feedback label
        status_lbl = tk.Label(
            dialog,
            text="",
            font=("Segoe UI", 9, "bold"),
            fg="#10B981",
            bg="#1E1612",
        )
        status_lbl.pack(fill=tk.X, padx=16, pady=(6, 2))

        def show_status(msg: str, is_error: bool = False) -> None:
            status_lbl.configure(text=msg, fg="#EF4444" if is_error else "#10B981")

        # Main Body
        body = tk.Frame(dialog, bg="#1E1612", padx=16, pady=4)
        body.pack(fill=tk.BOTH, expand=True)

        # --- Card 1: Admin / Owner ---
        admin_card = tk.LabelFrame(
            body,
            text=" 👑 Administrator / Owner Account ",
            bg="#2A1E19",
            fg="#EBC18F",
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=8,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        admin_card.pack(fill=tk.X, pady=(0, 10))

        admin_info = tk.Frame(admin_card, bg="#2A1E19")
        admin_info.pack(fill=tk.X, pady=(0, 6))
        tk.Label(
            admin_info,
            text="Username: admin (Fixed)",
            font=("Segoe UI", 9, "bold"),
            fg="#FFFFFF",
            bg="#2A1E19",
        ).pack(side=tk.LEFT)
        tk.Label(
            admin_info,
            text="Full dashboard, reports & inventory control",
            font=("Segoe UI", 8),
            fg="#A89485",
            bg="#2A1E19",
        ).pack(side=tk.LEFT, padx=12)

        admin_input_row = tk.Frame(admin_card, bg="#2A1E19")
        admin_input_row.pack(fill=tk.X)
        tk.Label(
            admin_input_row,
            text="New Owner Password:",
            font=("Segoe UI", 8),
            fg="#F5E6D3",
            bg="#2A1E19",
        ).pack(side=tk.LEFT, padx=(0, 8))

        admin_pwd_entry = tk.Entry(
            admin_input_row,
            show="*",
            width=24,
            bg="#1E1612",
            fg="#FFFFFF",
            insertbackground="#FFFFFF",
            relief=tk.FLAT,
            font=("Consolas", 9),
        )
        admin_pwd_entry.pack(side=tk.LEFT, padx=(0, 8))

        admin_show_var = tk.BooleanVar(value=False)
        def toggle_admin_show():
            admin_pwd_entry.configure(show="" if admin_show_var.get() else "*")
        tk.Checkbutton(
            admin_input_row,
            text="Show",
            variable=admin_show_var,
            command=toggle_admin_show,
            bg="#2A1E19",
            fg="#A89485",
            selectcolor="#1E1612",
            activebackground="#2A1E19",
            activeforeground="#FFFFFF",
            font=("Segoe UI", 8),
        ).pack(side=tk.LEFT, padx=(0, 10))

        def save_admin_pwd():
            new_p = admin_pwd_entry.get().strip()
            if len(new_p) < 8:
                show_status("Admin password must be at least 8 characters.", is_error=True)
                return
            show_status("Updating admin password...")
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "set-admin-password", new_p],
                        cwd=str(API_DIR),
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dialog.after(0, lambda: [show_status("Owner password updated successfully!"), admin_pwd_entry.delete(0, tk.END)])
                    else:
                        dialog.after(0, lambda: show_status(f"Error: {res.stderr or res.stdout}", is_error=True))
                except Exception as exc:
                    dialog.after(0, lambda: show_status(f"Error: {exc}", is_error=True))
            threading.Thread(target=_worker, daemon=True).start()

        self._make_button(
            admin_input_row,
            text="Save Owner Password",
            bg="#8B5E3C",
            fg="#FFFFFF",
            command=save_admin_pwd,
            padx=10,
            pady=3,
        ).pack(side=tk.LEFT)

        # --- Card 2: Cashier Team (Staff Accounts) ---
        cashier_card = tk.LabelFrame(
            body,
            text=" 👥 Counter Cashiers (Staff Accounts) ",
            bg="#2A1E19",
            fg="#EBC18F",
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=8,
            highlightthickness=1,
            highlightbackground="#3E2D25",
        )
        cashier_card.pack(fill=tk.BOTH, expand=True)

        tk.Label(
            cashier_card,
            text="Shared Login Username: 'staff' (case-insensitive). Entering their specific password identifies who is on duty.",
            font=("Segoe UI", 8),
            fg="#D6C4B4",
            bg="#2A1E19",
        ).pack(anchor="w", pady=(0, 6))

        # Add Cashier Row
        add_frame = tk.Frame(cashier_card, bg="#2A1E19", pady=4)
        add_frame.pack(fill=tk.X, pady=(0, 8))
        tk.Label(add_frame, text="Name:", font=("Segoe UI", 8), fg="#F5E6D3", bg="#2A1E19").pack(side=tk.LEFT, padx=(0, 4))
        new_name_entry = tk.Entry(add_frame, width=16, bg="#1E1612", fg="#FFFFFF", insertbackground="#FFFFFF", relief=tk.FLAT, font=("Consolas", 9))
        new_name_entry.insert(0, "Cashier 3")
        new_name_entry.pack(side=tk.LEFT, padx=(0, 8))

        tk.Label(add_frame, text="Password:", font=("Segoe UI", 8), fg="#F5E6D3", bg="#2A1E19").pack(side=tk.LEFT, padx=(0, 4))
        new_pwd_entry = tk.Entry(add_frame, width=16, bg="#1E1612", fg="#FFFFFF", insertbackground="#FFFFFF", relief=tk.FLAT, font=("Consolas", 9))
        new_pwd_entry.pack(side=tk.LEFT, padx=(0, 8))

        def add_new_cashier():
            name = new_name_entry.get().strip()
            pwd = new_pwd_entry.get().strip()
            if not name or len(pwd) < 6:
                show_status("Cashier name is required and password must be at least 6 characters.", is_error=True)
                return
            show_status(f"Adding {name}...")
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "add-cashier", name, pwd],
                        cwd=str(API_DIR),
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dialog.after(0, lambda: [show_status(f"Added {name} successfully!"), new_pwd_entry.delete(0, tk.END), reload_cashiers()])
                    else:
                        dialog.after(0, lambda: show_status(f"Error: {res.stderr or res.stdout}", is_error=True))
                except Exception as exc:
                    dialog.after(0, lambda: show_status(f"Error: {exc}", is_error=True))
            threading.Thread(target=_worker, daemon=True).start()

        self._make_button(
            add_frame,
            text="+ Add Cashier",
            bg="#3B2A22",
            fg="#A7F3D0",
            command=add_new_cashier,
            padx=10,
            pady=3,
        ).pack(side=tk.LEFT)

        # Cashiers list container
        list_container = tk.Frame(cashier_card, bg="#1E1612", highlightthickness=1, highlightbackground="#3E2D25")
        list_container.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

        cashiers_canvas = tk.Canvas(list_container, bg="#1E1612", highlightthickness=0)
        cashiers_scroll = tk.Scrollbar(list_container, orient=tk.VERTICAL, command=cashiers_canvas.yview)
        cashiers_canvas.configure(yscrollcommand=cashiers_scroll.set)
        cashiers_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        cashiers_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        list_frame = tk.Frame(cashiers_canvas, bg="#1E1612")
        canvas_window = cashiers_canvas.create_window((0, 0), window=list_frame, anchor="nw")

        def _on_canvas_configure(event):
            cashiers_canvas.itemconfig(canvas_window, width=event.width)
        cashiers_canvas.bind("<Configure>", _on_canvas_configure)
        list_frame.bind("<Configure>", lambda e: cashiers_canvas.configure(scrollregion=cashiers_canvas.bbox("all")))

        def reload_cashiers():
            for w in list_frame.winfo_children():
                w.destroy()
            show_status("Loading live cashiers...")
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "list"],
                        cwd=str(API_DIR),
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    accounts = []
                    for line in (res.stdout or "").splitlines():
                        if line.startswith("ACCOUNTS_JSON:"):
                            accounts = json.loads(line[len("ACCOUNTS_JSON:"):])
                            break
                    dialog.after(0, lambda: render_cashier_rows(accounts))
                except Exception as exc:
                    dialog.after(0, lambda: show_status(f"Failed to load cashiers: {exc}", is_error=True))
            threading.Thread(target=_worker, daemon=True).start()

        def render_cashier_rows(accounts):
            show_status("Live accounts loaded.")
            staff_list = [a for a in accounts if a.get("role") == "staff"]
            for w in list_frame.winfo_children():
                w.destroy()

            if not staff_list:
                tk.Label(list_frame, text="No cashiers found.", fg="#A89485", bg="#1E1612", font=("Segoe UI", 9)).pack(pady=10)
                return

            for idx, staff in enumerate(staff_list):
                row = tk.Frame(list_frame, bg="#2A1E19" if idx % 2 == 0 else "#241A15", padx=10, pady=8)
                row.pack(fill=tk.X, padx=4, pady=2)

                left = tk.Frame(row, bg=row["bg"])
                left.pack(side=tk.LEFT)
                name_lbl = tk.Label(left, text=f"👤 {staff.get('displayName')}", font=("Segoe UI", 9, "bold"), fg="#FFFFFF", bg=row["bg"])
                name_lbl.pack(anchor="w")
                sub_lbl = tk.Label(
                    left,
                    text=f"login: staff  |  Status: {'Active' if staff.get('isActive') else 'Deactivated'}",
                    font=("Segoe UI", 8),
                    fg="#10B981" if staff.get("isActive") else "#EF4444",
                    bg=row["bg"],
                )
                sub_lbl.pack(anchor="w")

                right = tk.Frame(row, bg=row["bg"])
                right.pack(side=tk.RIGHT)

                new_pwd_entry = tk.Entry(right, width=14, show="*", bg="#1E1612", fg="#FFFFFF", insertbackground="#FFFFFF", relief=tk.FLAT, font=("Consolas", 8))
                new_pwd_entry.pack(side=tk.LEFT, padx=(0, 6))

                def make_update_pwd_cmd(s_id, s_name, entry_widget):
                    def _update():
                        p = entry_widget.get().strip()
                        if len(p) < 6:
                            show_status(f"New password for {s_name} must be at least 6 characters.", is_error=True)
                            return
                        show_status(f"Updating password for {s_name}...")
                        def _w():
                            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                            res = subprocess.run([node_exe, "src/account-manager.js", "set-cashier-password", str(s_id), p], cwd=str(API_DIR), capture_output=True, text=True, creationflags=creationflags)
                            if res.returncode == 0:
                                dialog.after(0, lambda: [show_status(f"Password for {s_name} updated!"), entry_widget.delete(0, tk.END)])
                            else:
                                dialog.after(0, lambda: show_status(f"Error: {res.stderr or res.stdout}", is_error=True))
                        threading.Thread(target=_w, daemon=True).start()
                    return _update

                self._make_button(right, text="Set Password", bg="#3B2A22", fg="#F5E6D3", command=make_update_pwd_cmd(staff.get("id"), staff.get("displayName"), new_pwd_entry), padx=6, pady=2).pack(side=tk.LEFT, padx=(0, 4))

                def make_toggle_cmd(s_id, s_name):
                    def _toggle():
                        show_status(f"Toggling {s_name}...")
                        def _w():
                            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                            res = subprocess.run([node_exe, "src/account-manager.js", "toggle-cashier", str(s_id)], cwd=str(API_DIR), capture_output=True, text=True, creationflags=creationflags)
                            if res.returncode == 0:
                                dialog.after(0, lambda: reload_cashiers())
                            else:
                                dialog.after(0, lambda: show_status(f"Error: {res.stderr or res.stdout}", is_error=True))
                        threading.Thread(target=_w, daemon=True).start()
                    return _toggle

                self._make_button(
                    right,
                    text="Disable" if staff.get("isActive") else "Enable",
                    bg="#451A1A" if staff.get("isActive") else "#1A3A2A",
                    fg="#FEE2E2" if staff.get("isActive") else "#D1FAE5",
                    command=make_toggle_cmd(staff.get("id"), staff.get("displayName")),
                    padx=6,
                    pady=2,
                ).pack(side=tk.LEFT)

        reload_cashiers()

    # ------------------------------------------------------------------
    # SERVICE START / STOP / RESTART & PORT MANAGEMENT
    # ------------------------------------------------------------------
    def _get_service_config(self, service_id: str) -> dict:
        for cfg in SERVICES_CONFIG:
            if cfg["id"] == service_id:
                return cfg
        raise KeyError(f"Unknown service_id: {service_id}")

    def start_service(self, service_id: str) -> None:
        threading.Thread(target=self._start_service_worker, args=(service_id,), daemon=True).start()

    def _start_service_worker(self, service_id: str) -> bool:
        cfg = self._get_service_config(service_id)
        port = cfg["port"]

        # Special handling for XAMPP MySQL (:3306)
        if service_id == "mysql":
            if is_port_open(3306):
                pids = find_pids_on_port(3306)
                self.service_states["mysql"] = "RUNNING"
                self.enqueue_log(
                    "mysql",
                    "success",
                    f"MySQL is already running on Port :3306 (PID {pids[0] if pids else 'Active'}).",
                )
                return True

            if not XAMPP_MYSQLD.is_file():
                self.service_states["mysql"] = "ERROR"
                self.enqueue_log(
                    "mysql",
                    "error",
                    f"XAMPP mysqld.exe not found at {XAMPP_MYSQLD}. Please start your MySQL server manually.",
                )
                return False

            self.stop_requested["mysql"] = False
            self.service_states["mysql"] = "STARTING"
            creationflags = 0
            if os.name == "nt":
                creationflags = (
                    getattr(subprocess, "CREATE_NO_WINDOW", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                )

            cmd = [str(XAMPP_MYSQLD)]
            if XAMPP_MY_INI.is_file():
                cmd.append(f"--defaults-file={XAMPP_MY_INI}")
            cmd.append("--standalone")

            self.enqueue_log("mysql", "info", f"Starting XAMPP MySQL ({cmd[0]})...")
            try:
                proc = subprocess.Popen(
                    cmd,
                    cwd=str(XAMPP_MYSQL_BIN),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    bufsize=1,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=creationflags,
                )
                self.processes["mysql"] = proc
                threading.Thread(
                    target=self._read_process_output,
                    args=("mysql", proc),
                    daemon=True,
                ).start()
                return True
            except Exception as exc:
                self.service_states["mysql"] = "ERROR"
                self.enqueue_log("mysql", "error", f"Failed to start XAMPP MySQL: {exc}")
                return False

        # Standard Node/Vite services (api, customer, portal)
        existing_proc = self.processes.get(service_id)
        if existing_proc is not None and existing_proc.poll() is None:
            self.enqueue_log(service_id, "warn", f"{cfg['short_name']} is already running (PID {existing_proc.pid}).")
            return True

        if service_id == "api":
            self._ensure_api_env_file()
            if not self._install_dependencies_if_missing(API_DIR, "api"):
                self.service_states[service_id] = "ERROR"
                return False
        else:
            if not self._install_dependencies_if_missing(ROOT_DIR, service_id):
                self.service_states[service_id] = "ERROR"
                return False

        # Dual-stack IPv4 + IPv6 Port Conflict Guard
        pids = find_pids_on_port(port)
        if pids or is_port_open(port):
            self.enqueue_log(
                service_id,
                "warn",
                f"Port :{port} is occupied by stale PID(s) {pids}. Auto-terminating stale process tree...",
            )
            for pid in pids:
                ok, msg = kill_process_tree(pid)
                self.enqueue_log(
                    service_id,
                    "info" if ok else "warn",
                    f"Freed Port :{port} (PID {pid}): {msg}",
                )
            # Wait up to 1.5s for the OS to release the socket
            for _ in range(6):
                if not is_port_open(port):
                    break
                time.sleep(0.25)

        self.stop_requested[service_id] = False
        self.service_states[service_id] = "STARTING"

        env = os.environ.copy()
        env["FORCE_COLOR"] = "0"
        env["NO_COLOR"] = "1"
        env["BROWSER"] = "none"

        creationflags = 0
        if os.name == "nt":
            creationflags = (
                getattr(subprocess, "CREATE_NO_WINDOW", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            )

        cmd = [self.npm_exe] + cfg["npm_args"]
        self.enqueue_log(service_id, "info", f"Starting: {cfg['cmd_display']} (Port :{port})...")

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(cfg["cwd"]),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
                env=env,
                creationflags=creationflags,
            )
            self.processes[service_id] = proc
        except Exception as exc:
            self.service_states[service_id] = "ERROR"
            self.enqueue_log(service_id, "error", f"Failed to start {cfg['short_name']}: {exc}")
            return False

        threading.Thread(
            target=self._read_process_output,
            args=(service_id, proc),
            daemon=True,
        ).start()
        return True

    def _read_process_output(self, service_id: str, proc: subprocess.Popen) -> None:
        cfg = self._get_service_config(service_id)
        try:
            assert proc.stdout is not None
            for raw_line in iter(proc.stdout.readline, ""):
                if not raw_line:
                    break
                line = strip_ansi(raw_line).rstrip()
                if not line:
                    continue
                lower = line.lower()
                if "error" in lower or "eaddrinuse" in lower or "failed" in lower or "exception" in lower:
                    level = "error"
                elif "warn" in lower:
                    level = "warn"
                elif "listening on" in lower or "local:" in lower or "ready in" in lower or "ready for connections" in lower:
                    level = "success"
                else:
                    level = "normal"
                self.enqueue_log(service_id, level, line)
        except Exception as exc:
            if not self.stop_requested.get(service_id):
                self.enqueue_log(service_id, "error", f"Log stream error: {exc}")
        finally:
            rc = proc.poll()
            if self.processes.get(service_id) is proc:
                self.processes[service_id] = None
            if self.stop_requested.get(service_id):
                self.service_states[service_id] = "STOPPED"
                self.enqueue_log(service_id, "info", f"{cfg['short_name']} stopped.")
            else:
                self.service_states[service_id] = "ERROR" if (rc and rc != 0) else "STOPPED"
                self.enqueue_log(
                    service_id,
                    "error" if (rc and rc != 0) else "warn",
                    f"{cfg['short_name']} exited (code {rc}).",
                )

    def stop_service(self, service_id: str) -> None:
        threading.Thread(target=self._stop_service_worker, args=(service_id,), daemon=True).start()

    def _stop_service_worker(self, service_id: str) -> None:
        cfg = self._get_service_config(service_id)
        self.stop_requested[service_id] = True
        proc = self.processes.get(service_id)

        if service_id == "mysql" and XAMPP_MYSQLADMIN.is_file() and is_port_open(3306):
            self.enqueue_log("mysql", "info", "Shutting down XAMPP MySQL cleanly via mysqladmin...")
            try:
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                subprocess.run(
                    [str(XAMPP_MYSQLADMIN), "-u", "root", "shutdown"],
                    capture_output=True,
                    text=True,
                    timeout=6,
                    creationflags=creationflags,
                )
            except Exception:
                pass

        if proc is not None and proc.poll() is None:
            pid = proc.pid
            self.enqueue_log(service_id, "info", f"Stopping {cfg['short_name']} process tree (PID {pid})...")
            kill_process_tree(pid)
            self.processes[service_id] = None

        port_pids = find_pids_on_port(cfg["port"])
        for pid in port_pids:
            self.enqueue_log(service_id, "info", f"Releasing port :{cfg['port']} (PID {pid})...")
            kill_process_tree(pid)

        self.service_states[service_id] = "STOPPED"

    def restart_service(self, service_id: str) -> None:
        def _worker() -> None:
            self._stop_service_worker(service_id)
            time.sleep(0.6)
            self._start_service_worker(service_id)

        threading.Thread(target=_worker, daemon=True).start()

    def start_all_services(self) -> None:
        """Sequenced startup: 0. MySQL (:3306) -> 1. Backend API (:3001) -> 2. Customer (:5173) & 3. Portal (:5174)."""
        def _worker() -> None:
            self.enqueue_log("system", "info", "=== Starting All Amaya Services (MySQL -> API -> Customer & POS) ===")
            # Step 0: Start XAMPP MySQL (:3306) first!
            mysql_ok = self._start_service_worker("mysql")
            if mysql_ok:
                for _ in range(24):
                    if is_port_open(3306):
                        self.enqueue_log("mysql", "success", "MySQL Port :3306 is open and ready for connections!")
                        self.refresh_vault_status()
                        break
                    time.sleep(0.25)

            # Step 1: Start Backend API (:3001)
            api_started = self._start_service_worker("api")
            if api_started:
                for _ in range(14):
                    if is_port_open(3001):
                        break
                    time.sleep(0.25)

            # Step 2: Start Customer Website (:5173) & Staff/Admin Portal (:5174)
            self._start_service_worker("customer")
            self._start_service_worker("portal")

        threading.Thread(target=_worker, daemon=True).start()

    def stop_all_services(self) -> None:
        def _worker() -> None:
            self.enqueue_log("system", "info", "=== Stopping All Amaya Services ===")
            # Stop web & API first, then MySQL
            for sid in ("portal", "customer", "api", "mysql"):
                self._stop_service_worker(sid)

        threading.Thread(target=_worker, daemon=True).start()

    def restart_all_services(self) -> None:
        def _worker() -> None:
            self.enqueue_log("system", "info", "=== Restarting All Amaya Services ===")
            for sid in ("portal", "customer", "api"):
                self._stop_service_worker(sid)
            time.sleep(0.8)
            self.start_all_services()

        threading.Thread(target=_worker, daemon=True).start()

    def free_all_ports(self) -> None:
        def _worker() -> None:
            freed_any = False
            for cfg in SERVICES_CONFIG:
                if cfg["id"] == "mysql":
                    continue
                port = cfg["port"]
                pids = find_pids_on_port(port)
                for pid in pids:
                    freed_any = True
                    ok, msg = kill_process_tree(pid)
                    self.enqueue_log(
                        cfg["id"],
                        "success" if ok else "warn",
                        f"Port :{port} -> Killed PID {pid} ({msg})",
                    )
            if not freed_any:
                self.enqueue_log("system", "success", "Ports 3001, 5173, and 5174 are completely free (IPv4 & IPv6)!")

        threading.Thread(target=_worker, daemon=True).start()

    # ------------------------------------------------------------------
    # LOGGING & HEALTH POLLING
    # ------------------------------------------------------------------
    def enqueue_log(self, service_id: str, level: str, message: str) -> None:
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        self.log_queue.put((service_id, level, f"[{timestamp}] {message}"))

    def _poll_log_queue(self) -> None:
        try:
            while True:
                service_id, level, formatted = self.log_queue.get_nowait()
                self._append_to_text_widget("all", service_id, level, formatted)
                if service_id in self.log_widgets:
                    self._append_to_text_widget(service_id, service_id, level, formatted)
        except queue.Empty:
            pass
        if not self.is_closing:
            self.root.after(80, self._poll_log_queue)

    def _append_to_text_widget(self, tab_id: str, service_id: str, level: str, text: str) -> None:
        widget = self.log_widgets.get(tab_id)
        if widget is None:
            return

        prefix_map = {
            "mysql": "[MYSQL :3306] ",
            "api": "[API :3001] ",
            "customer": "[CUSTOMER :5173] ",
            "portal": "[PORTAL :5174] ",
            "system": "[SYSTEM] ",
        }
        prefix = prefix_map.get(service_id, "[LOG] ")
        prefix_tag = f"prefix_{service_id}" if service_id in prefix_map else "prefix_system"
        body_tag = level if level in ("error", "success", "warn") else "normal"

        widget.configure(state=tk.NORMAL)
        if tab_id == "all":
            widget.insert(tk.END, prefix, prefix_tag)
        widget.insert(tk.END, text + "\n", body_tag)
        if self.auto_scroll_var.get():
            widget.see(tk.END)
        widget.configure(state=tk.DISABLED)

    def _poll_service_health(self) -> None:
        if self.is_closing:
            return

        def _check_all() -> None:
            updates: dict[str, tuple[str, str, str, str]] = {}
            mysql_open = is_port_open(3306)

            for cfg in SERVICES_CONFIG:
                sid = cfg["id"]
                port = cfg["port"]
                proc = self.processes.get(sid)
                port_open = mysql_open if sid == "mysql" else is_port_open(port)

                if proc is not None and proc.poll() is None:
                    pid_str = str(proc.pid)
                elif port_open:
                    pids = find_pids_on_port(port)
                    pid_str = str(pids[0]) if pids else "Active"
                else:
                    pid_str = "—"

                if sid == "mysql":
                    if port_open:
                        badge_text = "● RUNNING"
                        badge_fg = "#4ADE80"
                        health_detail = "Listening on 127.0.0.1:3306"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_fg = "#FACC15"
                        health_detail = "Initializing InnoDB..."
                    else:
                        badge_text = "● STOPPED"
                        badge_fg = "#9CA3AF"
                        health_detail = "Offline (Click Start All)"
                elif sid == "api":
                    if port_open:
                        if not mysql_open:
                            # Do NOT call /api/health while Port 3306 is closed (prevents console spam!)
                            badge_text = "● MYSQL OFFLINE"
                            badge_fg = "#FBBF24"
                            health_detail = "Waiting for MySQL (:3306)"
                        else:
                            now = time.time()
                            if now - self._last_api_health_time >= 5.0:
                                self._cached_api_health = check_api_health()
                                self._last_api_health_time = now
                            health_state, health_detail = self._cached_api_health
                            if health_state == "ok":
                                badge_text = "● RUNNING"
                                badge_fg = "#4ADE80"
                            elif health_state == "db_error":
                                badge_text = "● DB WARNING"
                                badge_fg = "#FBBF24"
                            else:
                                badge_text = "● RUNNING"
                                badge_fg = "#4ADE80"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_fg = "#FACC15"
                        health_detail = "Booting Express..."
                    elif self.service_states.get(sid) == "ERROR":
                        badge_text = "● ERROR"
                        badge_fg = "#F87171"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● STOPPED"
                        badge_fg = "#9CA3AF"
                        health_detail = "Offline"
                else:
                    if port_open:
                        badge_text = "● RUNNING"
                        badge_fg = "#4ADE80"
                        health_detail = f"Serving http://localhost:{port}"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_fg = "#FACC15"
                        health_detail = "Starting Vite..."
                    elif self.service_states.get(sid) == "ERROR":
                        badge_text = "● ERROR"
                        badge_fg = "#F87171"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● STOPPED"
                        badge_fg = "#9CA3AF"
                        health_detail = "Offline"

                meta_text = f"Port: :{port}  |  PID: {pid_str}  |  Status: {health_detail}"
                updates[sid] = (badge_text, badge_fg, meta_text, pid_str)

            if not self.is_closing:
                self.root.after(0, lambda: self._apply_card_updates(updates))

        threading.Thread(target=_check_all, daemon=True).start()
        if not self.is_closing:
            self.root.after(1500, self._poll_service_health)

    def _apply_card_updates(self, updates: dict[str, tuple[str, str, str, str]]) -> None:
        for sid, (badge_text, badge_fg, meta_text, _) in updates.items():
            widgets = self.card_widgets.get(sid)
            if not widgets:
                continue
            widgets["badge"].configure(text=badge_text, fg=badge_fg)
            widgets["meta"].configure(text=meta_text)

    # ------------------------------------------------------------------
    # CONSOLE UTILITIES & CLEAN SHUTDOWN
    # ------------------------------------------------------------------
    def _current_tab_key(self) -> str:
        idx = self.notebook.index(self.notebook.select())
        return ["all", "mysql", "api", "customer", "portal"][idx]

    def clear_current_log(self) -> None:
        key = self._current_tab_key()
        widget = self.log_widgets.get(key)
        if widget:
            widget.configure(state=tk.NORMAL)
            widget.delete("1.0", tk.END)
            widget.configure(state=tk.DISABLED)

    def copy_current_log(self) -> None:
        key = self._current_tab_key()
        widget = self.log_widgets.get(key)
        if widget:
            content = widget.get("1.0", tk.END).strip()
            self.root.clipboard_clear()
            self.root.clipboard_append(content)
            self.enqueue_log("system", "success", f"Copied '{key}' tab logs to clipboard.")

    def on_close(self) -> None:
        running = [
            cfg["short_name"]
            for cfg in SERVICES_CONFIG
            if (self.processes.get(cfg["id"]) is not None and self.processes[cfg["id"]].poll() is None)
            or (cfg["id"] != "mysql" and is_port_open(cfg["port"]))
        ]
        if running:
            confirm = messagebox.askyesno(
                "Stop Amaya Services & Exit?",
                "The following services are still active:\n\n• "
                + "\n• ".join(running)
                + "\n\nStop all running services and close the Control Panel?",
            )
            if not confirm:
                return

        self.is_closing = True
        for sid in ("portal", "customer", "api", "mysql"):
            if self.processes.get(sid) is not None or sid != "mysql":
                self._stop_service_worker(sid)
        self.root.destroy()


def main() -> None:
    root = tk.Tk()
    AmayaControlPanel(root)
    root.mainloop()


if __name__ == "__main__":
    main()
