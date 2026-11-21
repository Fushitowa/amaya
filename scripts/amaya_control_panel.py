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

# ======================================================================
# AMAYA ATELIER DARK COFFEE & NOTEBOOK DESK PALETTE
# (Rich Roasted Coffee, Dark Leather Desk & Sticky Note Accents)
# Easy on the eyes, rich contrast, authentic notebook & sticky notes feel
# ======================================================================
COLOR_CANVAS_BG = "#18110D"       # Deep Roasted Coffee Bean Desk (Comfortable, zero glare)
COLOR_PANEL_WARM = "#231812"      # Dark Atelier Leather Panel / Desk Surface
COLOR_CARD_DARK = "#291D16"       # Secondary Card Background
COLOR_RECESSED = "#130C08"        # Recessed Dark Trough / Meter Background
COLOR_CARD_BORDER = "#3E2B20"     # Structural Card Frame / Leather Stitch Border
COLOR_HAIRLINE = "#2D1E16"        # Subtle Hairline Divider

# Typography (High Contrast on Dark Surfaces — Crisp and Clean)
COLOR_TEXT_PRIMARY = "#FFF8F0"    # Crisp Sunlit Paper White (Page & Card Titles)
COLOR_TEXT_SECONDARY = "#E8D8CB"  # Soft Warm Ivory (Field labels, status text)
COLOR_TEXT_WALNUT = "#C9B5A3"     # Medium Readable Text
COLOR_TEXT_MUTED = "#8E7A6E"      # Low-emphasis metadata, ports, timestamps

# Metallic Champagne Brass & Brand Accents
COLOR_BRASS = "#D4A359"           # Metallic Vintage Brass Rivets & Fasteners
COLOR_BRASS_LIGHT = "#F7E6C0"     # Champagne Specular Highlight
COLOR_ACCENT_LEATHER = "#B27A4E"  # Artisanal Warm Leather
COLOR_ACCENT_MOCHA = "#38251C"    # Dark Mocha Action

# Semantic Badges (Dark Mode, High Contrast)
COLOR_SUCCESS_BG = "#103318"      # Deep Forest Mint Pill
COLOR_SUCCESS_BORDER = "#166534"
COLOR_SUCCESS_TEXT = "#4ADE80"
COLOR_SUCCESS_BTN = "#166534"     # Dark Forest Sage Action Button
COLOR_SUCCESS_BTN_HOVER = "#1E7E42"

COLOR_DANGER_BG = "#381010"       # Deep Brick Wine Pill
COLOR_DANGER_BORDER = "#8E1E1E"
COLOR_DANGER_TEXT = "#FCA5A5"
COLOR_DANGER_BTN = "#8E1E1E"      # Brick Terracotta Danger Button
COLOR_DANGER_BTN_HOVER = "#A82626"

COLOR_WARN_BG = "#382408"         # Deep Amber Honey Pill
COLOR_WARN_BORDER = "#854D0E"
COLOR_WARN_TEXT = "#FDE047"

COLOR_NEUTRAL_BG = "#261B15"      # Neutral Dark Mocha Pill
COLOR_NEUTRAL_BORDER = "#3B2A21"
COLOR_NEUTRAL_TEXT = "#9E8D81"

COLOR_TERMINAL_BG = "#100A07"     # Dark Roasted Espresso Terminal
COLOR_TERMINAL_FG = "#E8DDD4"     # Warm Ivory Terminal Text

# Start-up progress colours (grey = waiting, amber = working, green = ready, red = problem)
STEP_PENDING = "#3E2B20"
STEP_WORKING = "#F59E0B"
STEP_READY = "#4ADE80"
STEP_ERROR = "#EF4444"
WARN_GRACE_SECONDS = 90  # a "warning" that lasts longer than this is treated as a failure

ANSI_ESCAPE_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")

SERVICES_CONFIG = [
    {
        "id": "mysql",
        "name": "0. XAMPP MySQL Database",
        "short_name": "MySQL DB",
        "tag_role": "CORE RELATIONAL DATABASE",
        "cmd_display": "mysqld --defaults-file=C:\\xampp\\mysql\\bin\\my.ini",
        "kind": "mysql",
        "cwd": XAMPP_MYSQL_BIN if XAMPP_MYSQL_BIN.is_dir() else ROOT_DIR,
        "port": 3306,
        "url": "http://localhost/phpmyadmin",
        "open_label": "phpMyAdmin",
        "accent": "#F59E0B",
        "pin_no": "#0",
        "tape_color": "#D97706",
        "card_bg": "#261D13",
        "pill_bg": "#3D270A",
        "pill_fg": "#FDE68A",
    },
    {
        "id": "api",
        "name": "1. Backend API (Express + MySQL)",
        "short_name": "Backend API",
        "tag_role": "REST API & BUSINESS LOGIC",
        "cmd_display": "cd api && npm run dev",
        "kind": "npm",
        "npm_args": ["run", "dev"],
        "cwd": API_DIR,
        "port": 3001,
        "url": "http://localhost:3001/api/health",
        "open_label": "/api/health",
        "accent": "#EA580C",
        "pin_no": "#1",
        "tape_color": "#C2410C",
        "card_bg": "#281911",
        "pill_bg": "#431508",
        "pill_fg": "#FED7AA",
    },
    {
        "id": "customer",
        "name": "2. Customer Website (Public Menu)",
        "short_name": "Customer Web",
        "tag_role": "PUBLIC MENU & ONLINE ORDERING",
        "cmd_display": "npm run dev:customer",
        "kind": "npm",
        "npm_args": ["run", "dev:customer"],
        "cwd": ROOT_DIR,
        "port": 5173,
        "url": "http://localhost:5173",
        "open_label": "Open :5173",
        "accent": "#22C55E",
        "pin_no": "#2",
        "tape_color": "#16A34A",
        "card_bg": "#142418",
        "pill_bg": "#062E17",
        "pill_fg": "#BBF7D0",
    },
    {
        "id": "portal",
        "name": "3. Staff POS & Admin Portal",
        "short_name": "POS & Admin",
        "tag_role": "STAFF REGISTER & ADMIN HUB",
        "cmd_display": "npm run dev:portal",
        "kind": "npm",
        "npm_args": ["run", "dev:portal"],
        "cwd": ROOT_DIR,
        "port": 5174,
        "url": "http://localhost:5174/login",
        "open_label": "Open POS :5174",
        "accent": "#3B82F6",
        "pin_no": "#3",
        "tape_color": "#2563EB",
        "card_bg": "#141D2B",
        "pill_bg": "#0E182A",
        "pill_fg": "#BFDBFE",
    },
]


def friendly_error(res) -> str:
    """Turn a failed account-manager run into a short sentence for the owner."""
    text = (res.stderr or res.stdout or "").strip()
    if "ECONNREFUSED" in text or "ETIMEDOUT" in text or "ENOTFOUND" in text:
        return "The database is off. Turn on the shop system first, then try again."
    for line in text.splitlines():
        if line.startswith("ERROR:"):
            return line[len("ERROR:"):].strip()
    if "ECONNREFUSED" in text or "connect" in text.lower():
        return "The database is off. Turn on the shop system first."
    return "Something went wrong. Please try again."


def strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def _is_weak_jwt_secret(val: str) -> bool:
    cleaned = val.strip().strip("\"'")
    return (
        len(cleaned) < 32
        or cleaned.lower().startswith("replace_with")
        or len(set(cleaned)) <= 4
    )


def _repair_jwt_secret_in_env(content: str) -> tuple[str, bool]:
    """Ensure JWT_SECRET is present and high-entropy; return (updated_text, changed)."""
    jwt_re = re.compile(r"^JWT_SECRET=([^\r\n]*)", flags=re.MULTILINE)
    found = False
    changed = False

    def _replace_if_weak(match: re.Match[str]) -> str:
        nonlocal found, changed
        found = True
        if _is_weak_jwt_secret(match.group(1)):
            changed = True
            return f"JWT_SECRET={secrets.token_hex(32)}"
        return match.group(0)

    updated = jwt_re.sub(_replace_if_weak, content)
    if not found:
        eol = "\r\n" if "\r\n" in updated else "\n"
        sep = "" if (not updated or updated.endswith("\n")) else eol
        updated = f"{updated}{sep}JWT_SECRET={secrets.token_hex(32)}{eol}"
        changed = True
    return updated, changed


def _read_env_file(env_path: pathlib.Path) -> dict[str, str]:
    """Parse simple KEY=VALUE pairs from a .env file without mutating os.environ."""
    values: dict[str, str] = {}
    if not env_path.is_file():
        return values
    try:
        for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
                val = val[1:-1]
            if key:
                values[key] = val
    except OSError:
        pass
    return values


def resolve_npm_executable() -> str:
    if os.name == "nt":
        return shutil.which("npm.cmd") or shutil.which("npm") or "npm.cmd"
    return shutil.which("npm") or "npm"


def is_port_open(port: int, timeout: float = 0.25) -> bool:
    """Check both IPv4 (127.0.0.1) and IPv6 (::1) loopback interfaces."""
    if port == 3306 and os.name == "nt":
        # Never open a TCP connection to MySQL just to see if it is up: every probe that
        # connects and hangs up makes MariaDB log an "Aborted connection" warning, which
        # flooded mysql_error.log (15,000+ lines). Read the listening-socket table instead.
        return bool(find_pids_on_port(port))
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


def find_mysqld_pids() -> list[int]:
    """Return PIDs of every running mysqld.exe (even one still in crash recovery, before :3306 opens)."""
    if os.name != "nt":
        return []
    try:
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq mysqld.exe", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=creationflags,
        )
        pids: list[int] = []
        for line in result.stdout.splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 2 and parts[0].lower() == "mysqld.exe":
                try:
                    pids.append(int(parts[1]))
                except ValueError:
                    pass
        return sorted(pids)
    except Exception:
        return []


MAX_LOG_LINES_PER_TAB = 5000
MYSQL_SERVICE_NAME = "mysql"  # name XAMPP uses when MySQL is installed as a Windows service


def mysql_service_state() -> str | None:
    """
    Return the Windows service state of XAMPP MySQL ("RUNNING", "STOPPED", ...) or None if
    MySQL is not installed as a service. As a service, Windows stops MySQL cleanly on
    shutdown/updates, which a child process of this panel cannot guarantee.
    """
    if os.name != "nt":
        return None
    try:
        result = subprocess.run(
            ["sc", "query", MYSQL_SERVICE_NAME],
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return None
    for line in result.stdout.splitlines():
        if line.strip().upper().startswith("STATE"):
            parts = line.split()
            return parts[-1].upper() if parts else None
    return None


# MySQL must NEVER be force-killed while it is flushing InnoDB pages to disk:
# a half-written page corrupts the table (this is what broke product_ingredients
# on 2026-11-19). These limits are deliberately generous.
MYSQL_STARTUP_WAIT_SECONDS = 300   # crash recovery can take minutes before :3306 opens
MYSQL_SHUTDOWN_WAIT_SECONDS = 180  # buffer pool flush after `mysqladmin shutdown`


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


def check_api_health(timeout: float = 2.0) -> tuple[str, str, list[str]]:
    """Query http://127.0.0.1:3001/api/health ONLY when MySQL (:3306) is reachable.

    Returns (state, detail, pending_migrations). States:
      ok          the API answers and the database matches the code
      migrations  the API answers, but the database is missing updates ("Update the database" fixes it;
                  Restart does not)
      db_error    the API answers but cannot reach the database
      down        no answer within `timeout` (a cold start or a node --watch reload takes ~1 s,
                  so the timeout must be well above that or a healthy server reads as down)
    """
    req = urllib.request.Request("http://127.0.0.1:3001/api/health", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            if resp.status == 200 and data.get("status") == "ok":
                pending = [str(name) for name in (data.get("pendingMigrations") or [])]
                if pending:
                    return "migrations", f"{len(pending)} database update(s) waiting", pending
                return "ok", "DB Connected (200 OK)", []
            return "db_error", f"HTTP {resp.status}", []
    except urllib.error.HTTPError as http_err:
        try:
            body = json.loads(http_err.read().decode("utf-8", errors="replace"))
            msg = body.get("message") or f"HTTP {http_err.code}"
        except Exception:
            msg = f"HTTP {http_err.code}"
        return "db_error", msg, []
    except Exception:
        return "down", "Offline", []


class AmayaControlPanel:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Amaya's Drinks and Bites — Shop control panel")
        self.root.geometry("1280x820")
        self.root.minsize(1040, 680)
        self.root.configure(bg=COLOR_CANVAS_BG)

        self.npm_exe = resolve_npm_executable()
        self.log_queue: queue.Queue[tuple[str, str, str]] = queue.Queue()
        self.is_closing = False
        self.auto_scroll_var = tk.BooleanVar(value=True)

        # Hardware Telemetry variables (RAM & CPU scaling)
        self.ram_pct_val: float = 0.0
        self.cpu_pct_val: float = 0.0
        self.port_dot_widgets: dict[int, tk.Label] = {}

        # Throttle /api/health HTTP requests so we never spam the Express console
        self._last_api_health_time: float = 0.0
        self._cached_api_health: tuple[str, str, list[str]] = ("ok", "Listening (:3001)", [])
        # Pending database updates: offer Setup / Migrate once per distinct set, never while one runs.
        self._migration_running = False
        self._migration_offered_for: tuple[str, ...] | None = None

        # Runtime state per service (protected by RLock for concurrent worker threads)
        self._state_lock = threading.RLock()
        self._backup_lock = threading.Lock()
        self._service_locks: dict[str, threading.RLock] = {
            cfg["id"]: threading.RLock() for cfg in SERVICES_CONFIG
        }
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

        # Navigation & Page state (Main Basic Panel vs. Advanced Panel)
        self.current_page = "main"
        self.sidebar_port_dots: dict[int, tk.Label] = {}
        self.sidebar_services_count_lbl: tk.Label | None = None
        self.main_system_status_banner: tk.Label | None = None
        self.admin_status_badge: tk.Label | None = None
        self.cashier_status_label: tk.Label | None = None
        self.cashier_rows_container: tk.Frame | None = None
        self._accounts_loaded_once = False
        self._mysql_was_online = False

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.enqueue_log(
            "system",
            "info",
            f"Amaya Control Panel v2.5 initialized at {ROOT_DIR} (Notebook & Atelier Design)",
        )
        self.root.after(150, self._run_initial_preflight_summary)
        self.root.after(80, self._poll_log_queue)
        self.root.after(1200, self._poll_service_health)
        threading.Thread(target=self._daily_backup_loop, daemon=True).start()

    # ------------------------------------------------------------------
    # UI CONSTRUCTION (NAVIGATION SIDEBAR + RESPONSIVE PAGES)
    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        # Root layout split: Left Sidebar (Fixed 230px) + Right Content Area (Flexible, auto-scales)
        self.main_split = tk.Frame(self.root, bg=COLOR_CANVAS_BG)
        self.main_split.pack(fill=tk.BOTH, expand=True)

        self._build_sidebar(self.main_split)

        self.content_area = tk.Frame(self.main_split, bg=COLOR_CANVAS_BG)
        self.content_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # 1. Main (Basic) Panel — Shows ONLY what matters for daily operations
        self.page_main = tk.Frame(self.content_area, bg=COLOR_CANVAS_BG)
        self._build_main_panel(self.page_main)

        # 2. Advanced Panel — Shows Telemetry (RAM/CPU), Migration, 4 Boxes, Vault & Logs
        self.page_advanced = tk.Frame(self.content_area, bg=COLOR_CANVAS_BG)
        self._build_advanced_panel(self.page_advanced)

        # Show Main Panel by default
        self.show_page("main")

    # ------------------------------------------------------------------
    # LEFT NAVIGATION SIDEBAR
    # ------------------------------------------------------------------
    def _build_sidebar(self, parent: tk.Widget) -> None:
        self.sidebar = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            width=230,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        self.sidebar.pack(side=tk.LEFT, fill=tk.Y)
        self.sidebar.pack_propagate(False)

        # Brand Header
        brand_frame = tk.Frame(self.sidebar, bg=COLOR_PANEL_WARM, padx=14, pady=16)
        brand_frame.pack(fill=tk.X)

        brand_top = tk.Frame(brand_frame, bg=COLOR_PANEL_WARM)
        brand_top.pack(fill=tk.X)

        icon_box = tk.Label(
            brand_top,
            text="☕",
            font=("Segoe UI Emoji", 14),
            bg=COLOR_RECESSED,
            fg=COLOR_BRASS,
            padx=8,
            pady=4,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        icon_box.pack(side=tk.LEFT, padx=(0, 10))

        brand_titles = tk.Frame(brand_top, bg=COLOR_PANEL_WARM)
        brand_titles.pack(side=tk.LEFT, fill=tk.Y)

        tk.Label(
            brand_titles,
            text="Amaya's Drinks\nand Bites",
            justify=tk.LEFT,
            font=("Georgia", 11, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        tk.Label(
            brand_titles,
            text="Shop control panel",
            font=("Segoe UI", 8),
            fg=COLOR_ACCENT_LEATHER,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        # Hairline Divider
        tk.Frame(self.sidebar, height=1, bg=COLOR_HAIRLINE).pack(fill=tk.X, padx=12, pady=(4, 14))


        # Nav Buttons
        nav_container = tk.Frame(self.sidebar, bg=COLOR_PANEL_WARM, padx=10)
        nav_container.pack(fill=tk.X)

        self.nav_btn_main = self._make_nav_button(
            nav_container,
            icon="🏠",
            title="Home",
            sub="Turn on, open, your team",
            target_page="main",
        )
        self.nav_btn_main.pack(fill=tk.X, pady=(0, 8))

        self.nav_btn_adv = self._make_nav_button(
            nav_container,
            icon="🛠",
            title="Technical tools",
            sub="For IT help only",
            target_page="advanced",
        )
        self.nav_btn_adv.pack(fill=tk.X, pady=(0, 8))

        # Spacer to push monitor to bottom
        spacer = tk.Frame(self.sidebar, bg=COLOR_PANEL_WARM)
        spacer.pack(fill=tk.BOTH, expand=True)

        # Bottom System Port Status Card
        bot_frame = tk.Frame(
            self.sidebar,
            bg=COLOR_RECESSED,
            padx=12,
            pady=10,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        bot_frame.pack(fill=tk.X, padx=10, pady=12)

        bot_hdr = tk.Frame(bot_frame, bg=COLOR_RECESSED)
        bot_hdr.pack(fill=tk.X, pady=(0, 6))

        tk.Label(
            bot_hdr,
            text="●",
            font=("Segoe UI", 6),
            fg=COLOR_BRASS,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT, padx=(0, 4))

        tk.Label(
            bot_hdr,
            text="System check",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT)

        self.sidebar_services_count_lbl = tk.Label(
            bot_hdr,
            text="0 of 4 ready",
            font=("Consolas", 8, "bold"),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        )
        self.sidebar_services_count_lbl.pack(side=tk.RIGHT)

        # Labelled status rows (plain names instead of port numbers)
        p_row = tk.Frame(bot_frame, bg=COLOR_RECESSED)
        p_row.pack(fill=tk.X, pady=(0, 6))
        for p, label in ((3306, "Database"), (3001, "Server"), (5173, "Customer site"), (5174, "Register site")):
            line = tk.Frame(p_row, bg=COLOR_RECESSED)
            line.pack(fill=tk.X, pady=1)
            dot = tk.Label(line, text="●", font=("Segoe UI", 8), fg="#665245", bg=COLOR_RECESSED)
            dot.pack(side=tk.LEFT, padx=(0, 6))
            tk.Label(line, text=label, font=("Segoe UI", 9), fg=COLOR_TEXT_SECONDARY, bg=COLOR_RECESSED).pack(side=tk.LEFT)
            self.sidebar_port_dots[p] = dot

        tk.Label(
            bot_frame,
            text="Amaya's Drinks and Bites",
            font=("Consolas", 7),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        ).pack(anchor="w")

    def _make_nav_button(
        self,
        parent: tk.Widget,
        icon: str,
        title: str,
        sub: str,
        target_page: str,
    ) -> tk.Frame:
        card = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=10,
            pady=8,
            cursor="hand2",
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )

        def _on_click(event=None):
            self.show_page(target_page)

        card.bind("<Button-1>", _on_click)

        top_row = tk.Frame(card, bg=COLOR_PANEL_WARM)
        top_row.pack(fill=tk.X)
        top_row.bind("<Button-1>", _on_click)

        icon_lbl = tk.Label(top_row, text=icon, font=("Segoe UI Emoji", 11), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM)
        icon_lbl.pack(side=tk.LEFT, padx=(0, 6))
        icon_lbl.bind("<Button-1>", _on_click)

        title_lbl = tk.Label(top_row, text=title, font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM)
        title_lbl.pack(side=tk.LEFT)
        title_lbl.bind("<Button-1>", _on_click)

        sub_lbl = tk.Label(card, text=sub, font=("Segoe UI", 7), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM)
        sub_lbl.pack(anchor="w", padx=(22, 0), pady=(1, 0))
        sub_lbl.bind("<Button-1>", _on_click)

        card._title_lbl = title_lbl
        card._sub_lbl = sub_lbl
        card._icon_lbl = icon_lbl
        card._top_row = top_row
        return card

    def show_page(self, page_name: str) -> None:
        if page_name == "main":
            self._tech_unlocked = False  # leaving Technical tools locks it again
        elif page_name == "advanced" and not getattr(self, "_tech_unlocked", False):
            self._admin_gate(
                title="Owner password needed",
                headline="Technical tools are for the owner only",
                warnings=[
                    "This page can stop the shop system and clear your menu and stock list.",
                    "Only open it if you need to save a backup or fix a problem.",
                    "If you are not the owner, press Cancel.",
                ],
                confirm_label="Open Technical tools",
                on_success=self._unlock_tech_tools,
                require_ack=False,
                danger=False,
            )
            return
        self.current_page = page_name
        if page_name == "main":
            self.page_advanced.pack_forget()
            self.page_main.pack(fill=tk.BOTH, expand=True, padx=14, pady=12)

            self._set_nav_active(self.nav_btn_main, True)
            self._set_nav_active(self.nav_btn_adv, False)

            if not self._accounts_loaded_once:
                self.load_main_accounts()
                self._accounts_loaded_once = True
        else:
            self.page_main.pack_forget()
            self.page_advanced.pack(fill=tk.BOTH, expand=True, padx=14, pady=12)

            self._set_nav_active(self.nav_btn_main, False)
            self._set_nav_active(self.nav_btn_adv, True)

            self.root.after(40, self._redraw_ram_meter)
            self.root.after(40, self._redraw_cpu_meter)

    def _unlock_tech_tools(self) -> None:
        self._tech_unlocked = True
        self.show_page("advanced")

    def _set_nav_active(self, btn_frame: tk.Frame, is_active: bool) -> None:
        bg_col = COLOR_CARD_DARK if is_active else COLOR_PANEL_WARM
        border_col = COLOR_BRASS if is_active else COLOR_CARD_BORDER

        btn_frame.configure(bg=bg_col, highlightbackground=border_col, highlightthickness=1)
        btn_frame._top_row.configure(bg=bg_col)
        btn_frame._title_lbl.configure(bg=bg_col, fg=COLOR_TEXT_PRIMARY if is_active else COLOR_TEXT_WALNUT)
        btn_frame._sub_lbl.configure(bg=bg_col, fg=COLOR_BRASS_LIGHT if is_active else COLOR_TEXT_MUTED)
        btn_frame._icon_lbl.configure(bg=bg_col)

    # ------------------------------------------------------------------
    # MAIN (BASIC) PANEL — SHOWS ONLY WHAT MATTERS
    # ------------------------------------------------------------------
    def _build_main_panel(self, parent: tk.Widget) -> None:
        """Home page for the shop owner: one status, one big button, then open-links and team."""
        # ---- Greeting ----------------------------------------------------
        head = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        head.pack(fill=tk.X, pady=(4, 14))
        tk.Label(
            head, text="Welcome back", font=("Georgia", 22, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w")
        tk.Label(
            head,
            text="Turn the shop system on before you open. Turn it off after closing.",
            font=("Segoe UI", 11), fg=COLOR_TEXT_WALNUT, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w", pady=(2, 0))

        # ---- 1. Shop system power card ------------------------------------
        power = tk.Frame(
            parent, bg=COLOR_CARD_DARK, padx=22, pady=18,
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        power.pack(fill=tk.X, pady=(0, 12))
        self.main_power_card = power

        power_top = tk.Frame(power, bg=COLOR_CARD_DARK)
        power_top.pack(fill=tk.X)

        left = tk.Frame(power_top, bg=COLOR_CARD_DARK)
        left.pack(side=tk.LEFT, fill=tk.X, expand=True)

        status_row = tk.Frame(left, bg=COLOR_CARD_DARK)
        status_row.pack(anchor="w")
        self.main_status_dot = tk.Label(
            status_row, text="●", font=("Segoe UI", 20),
            fg=COLOR_DANGER_TEXT, bg=COLOR_CARD_DARK,
        )
        self.main_status_dot.pack(side=tk.LEFT, padx=(0, 10))
        # Kept under the old attribute name so other code that touches it still works.
        self.main_system_status_banner = tk.Label(
            status_row, text="The shop system is off", font=("Georgia", 18, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK,
        )
        self.main_system_status_banner.pack(side=tk.LEFT)

        self.main_status_sub = tk.Label(
            left, text="Customers cannot order and cashiers cannot sign in yet.",
            font=("Segoe UI", 11), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
            wraplength=520, justify=tk.LEFT,
        )
        self.main_status_sub.pack(anchor="w", pady=(4, 0))

        right = tk.Frame(power_top, bg=COLOR_CARD_DARK)
        right.pack(side=tk.RIGHT)
        self.main_power_btn = tk.Button(
            right, text="Turn on shop system", font=("Segoe UI", 13, "bold"),
            bg=COLOR_SUCCESS_BTN, fg="#FFFFFF", activebackground=COLOR_SUCCESS_BTN_HOVER,
            activeforeground="#FFFFFF", relief=tk.FLAT, cursor="hand2",
            padx=26, pady=12, command=self._on_power_clicked,
        )
        self.main_power_btn.pack()
        restart_link = tk.Label(
            right, text="Something wrong? Restart", font=("Segoe UI", 9, "underline"),
            fg=COLOR_TEXT_MUTED, bg=COLOR_CARD_DARK, cursor="hand2",
        )
        restart_link.pack(pady=(8, 0))
        restart_link.bind("<Button-1>", lambda _e: self._confirm_restart())

        # Start-up progress: four steps, shown only while the system is starting or running.
        self.main_steps_frame = tk.Frame(power, bg=COLOR_CARD_DARK)
        self._step_order = ("mysql", "api", "customer", "portal")
        self._step_names = {
            "mysql": "Database", "api": "Server",
            "customer": "Customer site", "portal": "Register site",
        }
        self._step_bars: dict[str, tk.Frame] = {}
        self._step_state_lbls: dict[str, tk.Label] = {}
        for i, sid in enumerate(self._step_order):
            self.main_steps_frame.columnconfigure(i, weight=1, uniform="steps")
            col = tk.Frame(self.main_steps_frame, bg=COLOR_CARD_DARK)
            col.grid(row=0, column=i, sticky="ew", padx=(0 if i == 0 else 4, 0 if i == 3 else 4))
            bar = tk.Frame(col, height=10, bg=STEP_PENDING)
            bar.pack(fill=tk.X)
            tk.Label(col, text=self._step_names[sid], font=("Segoe UI", 10, "bold"),
                     fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK).pack(anchor="w", pady=(6, 0))
            st = tk.Label(col, text="Waiting", font=("Segoe UI", 9), fg=COLOR_TEXT_MUTED, bg=COLOR_CARD_DARK)
            st.pack(anchor="w")
            self._step_bars[sid] = bar
            self._step_state_lbls[sid] = st

        # ---- 2. Open the shop's websites ----------------------------------
        tk.Label(
            parent, text="Open", font=("Georgia", 13, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w", pady=(4, 6))

        tiles = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        tiles.pack(fill=tk.X, pady=(0, 12))
        tiles.columnconfigure(0, weight=1, uniform="tiles")
        tiles.columnconfigure(1, weight=1, uniform="tiles")

        self.main_tile_subs: list[tk.Label] = []
        self._make_launch_tile(
            tiles, 0, "Customer menu",
            "What customers see when they order.",
            "http://localhost:5173", "#F59E0B",
        ).grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self._make_launch_tile(
            tiles, 1, "Register and admin",
            "For you and your cashiers: sales, stock, reports.",
            "http://localhost:5174/login", "#3B82F6",
        ).grid(row=0, column=1, sticky="nsew", padx=(6, 0))

        # ---- 3. Your team --------------------------------------------------
        team_head = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        team_head.pack(fill=tk.X, pady=(4, 6))
        tk.Label(
            team_head, text="Your team", font=("Georgia", 13, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(side=tk.LEFT)
        refresh = tk.Label(
            team_head, text="Refresh list", font=("Segoe UI", 9, "underline"),
            fg=COLOR_TEXT_MUTED, bg=COLOR_CANVAS_BG, cursor="hand2",
        )
        refresh.pack(side=tk.RIGHT)
        refresh.bind("<Button-1>", lambda _e: self.load_main_accounts())

        shelf = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        shelf.pack(fill=tk.BOTH, expand=True)
        shelf.columnconfigure(0, weight=1, uniform="team")
        shelf.columnconfigure(1, weight=1, uniform="team")
        shelf.rowconfigure(0, weight=1)

        # --- Owner -----------------------------------------------------------
        owner_card = tk.Frame(
            shelf, bg=COLOR_CARD_DARK, padx=18, pady=14,
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        owner_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6))

        o_top = tk.Frame(owner_card, bg=COLOR_CARD_DARK)
        o_top.pack(fill=tk.X)
        tk.Label(
            o_top, text="You (owner)", font=("Segoe UI", 12, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK,
        ).pack(side=tk.LEFT)
        self.admin_status_badge = tk.Label(
            o_top, text="Checking…", font=("Segoe UI", 9, "bold"),
            fg=COLOR_TEXT_MUTED, bg=COLOR_RECESSED, padx=8, pady=2,
        )
        self.admin_status_badge.pack(side=tk.RIGHT)

        tk.Label(
            owner_card,
            text="Sign in with the username  admin  and your password. You can see everything in the store.",
            font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
            wraplength=380, justify=tk.LEFT,
        ).pack(anchor="w", pady=(8, 14))

        self._make_button(
            owner_card, text="Change my password", bg=COLOR_ACCENT_MOCHA, fg="#FFFFFF",
            command=self.prompt_change_admin_password, padx=14, pady=7,
            border_color=COLOR_BRASS,
        ).pack(anchor="w", side=tk.BOTTOM)

        # --- Cashiers -------------------------------------------------------
        cashier_card = tk.Frame(
            shelf, bg=COLOR_CARD_DARK, padx=18, pady=14,
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        cashier_card.grid(row=0, column=1, sticky="nsew", padx=(6, 0))

        c_top = tk.Frame(cashier_card, bg=COLOR_CARD_DARK)
        c_top.pack(fill=tk.X)
        tk.Label(
            c_top, text="Cashiers", font=("Segoe UI", 12, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK,
        ).pack(side=tk.LEFT)
        self.cashier_status_label = tk.Label(
            c_top, text="Loading…", font=("Segoe UI", 9),
            fg=COLOR_TEXT_MUTED, bg=COLOR_CARD_DARK,
        )
        self.cashier_status_label.pack(side=tk.RIGHT)

        tk.Label(
            cashier_card,
            text="Each cashier signs in with the username  staff  and their own password.",
            font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
            wraplength=380, justify=tk.LEFT,
        ).pack(anchor="w", pady=(6, 8))

        c_btn_row = tk.Frame(cashier_card, bg=COLOR_CARD_DARK)
        c_btn_row.pack(fill=tk.X, side=tk.BOTTOM, pady=(10, 0))
        self._make_button(
            c_btn_row, text="Add a cashier", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF",
            command=self.prompt_add_cashier, padx=14, pady=7,
        ).pack(side=tk.LEFT, padx=(0, 8))
        self._make_button(
            c_btn_row, text="Change password or turn off", bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_SECONDARY, command=self.open_accounts_manager_dialog,
            padx=14, pady=7, border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT)

        list_outer = tk.Frame(cashier_card, bg=COLOR_RECESSED)
        list_outer.pack(fill=tk.BOTH, expand=True)
        self.cashier_canvas = tk.Canvas(list_outer, bg=COLOR_RECESSED, highlightthickness=0, height=90)
        c_scroll = tk.Scrollbar(list_outer, orient=tk.VERTICAL, command=self.cashier_canvas.yview)
        self.cashier_canvas.configure(yscrollcommand=c_scroll.set)
        c_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.cashier_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.cashier_rows_container = tk.Frame(self.cashier_canvas, bg=COLOR_RECESSED)
        c_win = self.cashier_canvas.create_window((0, 0), window=self.cashier_rows_container, anchor="nw")
        self.cashier_canvas.bind("<Configure>", lambda e: self.cashier_canvas.itemconfig(c_win, width=e.width))
        self.cashier_rows_container.bind(
            "<Configure>",
            lambda e: self.cashier_canvas.configure(scrollregion=self.cashier_canvas.bbox("all")),
        )

        self._update_main_status(0)

    # -- Home page helpers ---------------------------------------------------
    def _make_launch_tile(self, parent, idx, title, desc, url, accent) -> tk.Frame:
        tile = tk.Frame(
            parent, bg=COLOR_CARD_DARK, padx=0, pady=0, cursor="hand2",
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        tk.Frame(tile, width=5, bg=accent).pack(side=tk.LEFT, fill=tk.Y)
        body = tk.Frame(tile, bg=COLOR_CARD_DARK, padx=16, pady=12)
        body.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        t = tk.Label(body, text=title, font=("Segoe UI", 12, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK)
        t.pack(anchor="w")
        d = tk.Label(body, text=desc, font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
                     wraplength=330, justify=tk.LEFT)
        d.pack(anchor="w", pady=(2, 0))
        arrow = tk.Label(tile, text="Open", font=("Segoe UI", 10, "bold"), fg=accent, bg=COLOR_CARD_DARK, padx=16)
        arrow.pack(side=tk.RIGHT)

        def _open(_e=None) -> None:
            if getattr(self, "_shop_active_ports", 0) < 4:
                if not messagebox.askyesno(
                    "Shop system is not fully on",
                    "This page may not load yet because the shop system is not fully on.\n\nOpen it anyway?",
                ):
                    return
            webbrowser.open(url)

        for w in (tile, body, t, d, arrow):
            w.bind("<Button-1>", _open)
        return tile

    def _on_power_clicked(self) -> None:
        active = getattr(self, "_shop_active_ports", 0)
        if getattr(self, "_shop_has_error", False):
            self._begin_start_tracking()
            self.restart_all_services()
        elif active == 0:
            self._begin_start_tracking()
            self.start_all_services()
        elif messagebox.askyesno(
            "Turn off the shop system?",
            "Customers will not be able to order and cashiers will be signed out of the register.\n\nTurn it off?",
        ):
            self._suppress_errors = True  # a normal shutdown must not look like a failure
            self._start_clicked_at = 0.0
            self.stop_all_services()

    def _begin_start_tracking(self) -> None:
        self._suppress_errors = False
        self._start_clicked_at = time.time()
        self._warn_since = {}

    def _confirm_restart(self) -> None:
        if messagebox.askyesno(
            "Restart the shop system?",
            "This takes about a minute. Cashiers may need to refresh their page.\n\nRestart now?",
        ):
            self._begin_start_tracking()
            self.restart_all_services()

    def _update_main_status(self, active_ports: int, step_styles: dict[str, str] | None = None) -> None:
        self._shop_active_ports = active_ports
        step_styles = step_styles or {}
        now = time.time()
        suppress = getattr(self, "_suppress_errors", False)
        warn_since = getattr(self, "_warn_since", None)
        if warn_since is None:
            warn_since = self._warn_since = {}

        # Work out each step: pending / working / ready / error
        steps: dict[str, str] = {}
        for sid in self._step_order:
            style = step_styles.get(sid, "STOPPED")
            if style == "RUNNING":
                steps[sid] = "ready"
                warn_since.pop(sid, None)
            elif style == "ERROR" and not suppress:
                steps[sid] = "error"
            elif style == "WARN" and not suppress:
                first = warn_since.setdefault(sid, now)
                steps[sid] = "error" if now - first > WARN_GRACE_SECONDS else "working"
            elif style == "STARTING":
                steps[sid] = "working"
                warn_since.pop(sid, None)
            else:
                steps[sid] = "pending"
                warn_since.pop(sid, None)

        ready = sum(1 for v in steps.values() if v == "ready")
        failed = [sid for sid, v in steps.items() if v == "error"]
        recently_clicked = now - getattr(self, "_start_clicked_at", 0.0) < 20
        busy = any(v in ("working", "error") for v in steps.values()) or recently_clicked
        self._shop_has_error = bool(failed)

        step_verbs = {
            "mysql": "Starting the database", "api": "Starting the server",
            "customer": "Starting the customer site", "portal": "Starting the register site",
        }
        if failed:
            dot, head = STEP_ERROR, "Something went wrong"
            names = " and ".join(self._step_names[f] for f in failed)
            sub = f"The {names.lower()} did not start properly. Press Try again. If it keeps happening, call your IT person."
            btn = ("Try again", COLOR_DANGER_BTN, COLOR_DANGER_BTN_HOVER)
        elif ready >= 4:
            dot, head = STEP_READY, "The shop system is on"
            sub = "Customers can order and cashiers can sign in."
            btn = ("Turn off", COLOR_DANGER_BTN, COLOR_DANGER_BTN_HOVER)
        elif busy:
            dot, head = STEP_WORKING, f"Getting ready… {ready} of 4 done"
            first_wait = next((s_ for s_ in self._step_order if steps[s_] != "ready"), "mysql")
            sub = step_verbs[first_wait] + ". This can take up to a minute."
            btn = ("Turn off", COLOR_DANGER_BTN, COLOR_DANGER_BTN_HOVER)
        else:
            dot, head = COLOR_DANGER_TEXT, "The shop system is off"
            sub = "Customers cannot order and cashiers cannot sign in yet."
            btn = ("Turn on shop system", COLOR_SUCCESS_BTN, COLOR_SUCCESS_BTN_HOVER)

        if not getattr(self, "main_status_dot", None):
            return
        self.main_status_dot.configure(fg=dot)
        self.main_system_status_banner.configure(text=head)
        self.main_status_sub.configure(text=sub)
        self.main_power_btn.configure(text=btn[0], bg=btn[1], activebackground=btn[2])

        # Progress segments
        if busy or ready > 0:
            if not self.main_steps_frame.winfo_ismapped():
                self.main_steps_frame.pack(fill=tk.X, pady=(16, 0))
            colours = {"pending": STEP_PENDING, "working": STEP_WORKING, "ready": STEP_READY, "error": STEP_ERROR}
            labels = {"pending": ("Waiting", COLOR_TEXT_MUTED), "working": ("Starting…", STEP_WORKING),
                      "ready": ("Ready", STEP_READY), "error": ("Problem", STEP_ERROR)}
            for sid in self._step_order:
                self._step_bars[sid].configure(bg=colours[steps[sid]])
                text, colour = labels[steps[sid]]
                self._step_state_lbls[sid].configure(text=text, fg=colour)
        elif self.main_steps_frame.winfo_ismapped():
            self.main_steps_frame.pack_forget()

    def load_main_accounts(self) -> None:
        if hasattr(self, "cashier_status_label") and self.cashier_status_label:
            self.cashier_status_label.configure(text="Loading…", fg=COLOR_WARN_TEXT)

        def _worker():
            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            try:
                res = subprocess.run(
                    [node_exe, "src/account-manager.js", "list"],
                    cwd=str(API_DIR),
                    capture_output=True,
                    text=True,
                    timeout=5,
                    creationflags=creationflags,
                )
                accounts = []
                for line in (res.stdout or "").splitlines():
                    if line.startswith("ACCOUNTS_JSON:"):
                        accounts = json.loads(line[len("ACCOUNTS_JSON:"):])
                        break
                self.root.after(0, lambda: self._render_main_accounts(accounts, error=None if accounts else "No accounts returned"))
            except Exception as exc:
                self.root.after(0, lambda: self._render_main_accounts([], error=str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

    def _render_main_accounts(self, accounts: list[dict], error: str | None = None) -> None:
        if not hasattr(self, "cashier_rows_container") or not self.cashier_rows_container:
            return

        for w in self.cashier_rows_container.winfo_children():
            w.destroy()

        def _note(text: str, fg: str) -> None:
            tk.Label(
                self.cashier_rows_container, text=text, font=("Segoe UI", 10),
                fg=fg, bg=COLOR_RECESSED, wraplength=360, justify=tk.LEFT, padx=10, pady=10,
            ).pack(anchor="w")

        if error or not accounts:
            self.cashier_status_label.configure(text="", fg=COLOR_TEXT_MUTED)
            self.admin_status_badge.configure(text="Not checked", fg=COLOR_TEXT_MUTED, bg=COLOR_RECESSED)
            if error:
                _note("Cannot load cashiers yet. Turn on the shop system first, then press Refresh list.", COLOR_WARN_TEXT)
            else:
                _note("No cashiers yet. Press Add a cashier.", COLOR_TEXT_MUTED)
            return

        staff_list = [a for a in accounts if a.get("role") == "staff"]
        active_n = sum(1 for a in staff_list if a.get("isActive", True))
        self.cashier_status_label.configure(
            text=f"{active_n} can sign in" if staff_list else "", fg=COLOR_SUCCESS_TEXT,
        )

        if any(a.get("role") == "admin" for a in accounts):
            self.admin_status_badge.configure(text="Account ready", fg=COLOR_SUCCESS_TEXT, bg=COLOR_SUCCESS_BG)

        if not staff_list:
            _note("No cashiers yet. Press Add a cashier.", COLOR_TEXT_MUTED)
            return

        for idx, staff in enumerate(staff_list):
            row_bg = COLOR_PANEL_WARM if idx % 2 == 0 else COLOR_CARD_DARK
            row = tk.Frame(self.cashier_rows_container, bg=row_bg, padx=10, pady=7)
            row.pack(fill=tk.X)
            dname = staff.get("displayName") or f"Cashier {staff.get('id')}"
            tk.Label(row, text=dname, font=("Segoe UI", 10, "bold"), fg=COLOR_TEXT_PRIMARY, bg=row_bg).pack(side=tk.LEFT)
            is_act = staff.get("isActive", True)
            tk.Label(
                row, text="Can sign in" if is_act else "Turned off",
                font=("Segoe UI", 9, "bold"),
                fg=COLOR_SUCCESS_TEXT if is_act else COLOR_DANGER_TEXT, bg=row_bg,
            ).pack(side=tk.RIGHT)

    def _center_dialog(self, dlg: tk.Toplevel, width: int, height: int) -> None:
        """Open a dialog centred over the main window (not at the screen's top-left)."""
        self.root.update_idletasks()
        rx, ry = self.root.winfo_rootx(), self.root.winfo_rooty()
        rw, rh = self.root.winfo_width(), self.root.winfo_height()
        x = max(0, rx + (rw - width) // 2)
        y = max(0, ry + (rh - height) // 2)
        dlg.geometry(f"{width}x{height}+{x}+{y}")

    def prompt_change_admin_password(self) -> None:
        dlg = tk.Toplevel(self.root)
        dlg.title("Change Owner Password")
        self._center_dialog(dlg, 420, 330)
        dlg.minsize(380, 320)
        dlg.configure(bg=COLOR_CANVAS_BG)
        dlg.transient(self.root)
        dlg.grab_set()

        hdr = tk.Frame(dlg, bg=COLOR_PANEL_WARM, padx=14, pady=10, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text="🔑 CHANGE STORE OWNER PASSWORD", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM).pack(anchor="w")
        tk.Label(hdr, text="Account: admin (Username cannot be changed)", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(anchor="w")

        body = tk.Frame(dlg, bg=COLOR_CANVAS_BG, padx=16, pady=12)
        body.pack(fill=tk.BOTH, expand=True)

        tk.Label(body, text="Current password:", font=("Segoe UI", 8, "bold"), fg=COLOR_TEXT_SECONDARY, bg=COLOR_CANVAS_BG).pack(anchor="w", pady=(0, 4))
        cur_entry = tk.Entry(body, show="*", width=28, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 10), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        cur_entry.pack(fill=tk.X, pady=(0, 10))
        cur_entry.focus_set()

        tk.Label(body, text="New password (at least 8 characters):", font=("Segoe UI", 8, "bold"), fg=COLOR_TEXT_SECONDARY, bg=COLOR_CANVAS_BG).pack(anchor="w", pady=(0, 4))
        pwd_entry = tk.Entry(body, show="*", width=28, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 10), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        pwd_entry.pack(fill=tk.X, pady=(0, 8))

        msg_lbl = tk.Label(body, text="", font=("Segoe UI", 8), fg=COLOR_DANGER_TEXT, bg=COLOR_CANVAS_BG)
        msg_lbl.pack(anchor="w", pady=(0, 8))

        def _save():
            new_p = pwd_entry.get().strip()
            cur_p = cur_entry.get()
            if not cur_p:
                msg_lbl.configure(text="Enter your current password first.", fg=COLOR_DANGER_TEXT)
                return
            if len(new_p) < 8:
                msg_lbl.configure(text="Password must be at least 8 characters.", fg=COLOR_DANGER_TEXT)
                return
            msg_lbl.configure(text="Updating password in database...", fg=COLOR_WARN_TEXT)
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "set-admin-password", "--password-stdin"],
                        cwd=str(API_DIR),
                        input=f"{cur_p}\n{new_p}\n",
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dlg.after(0, lambda: [
                            messagebox.showinfo("Success", "Owner (admin) password updated successfully!"),
                            dlg.destroy(),
                            self.load_main_accounts(),
                        ])
                    else:
                        dlg.after(0, lambda: msg_lbl.configure(text=(res.stderr or res.stdout or "").replace("ERROR:", "").strip() or "Could not change the password.", fg=COLOR_DANGER_TEXT))
                except Exception as exc:
                    dlg.after(0, lambda: msg_lbl.configure(text=f"Error: {exc}", fg=COLOR_DANGER_TEXT))
            threading.Thread(target=_worker, daemon=True).start()

        btn_row = tk.Frame(body, bg=COLOR_CANVAS_BG)
        btn_row.pack(fill=tk.X)
        self._make_button(btn_row, text="Save Password", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF", command=_save, padx=12, pady=4).pack(side=tk.LEFT)
        self._make_button(btn_row, text="Cancel", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=dlg.destroy, padx=10, pady=4).pack(side=tk.RIGHT)

    def prompt_add_cashier(self) -> None:
        dlg = tk.Toplevel(self.root)
        dlg.title("Add New Cashier")
        self._center_dialog(dlg, 420, 290)
        dlg.minsize(380, 260)
        dlg.configure(bg=COLOR_CANVAS_BG)
        dlg.transient(self.root)
        dlg.grab_set()

        hdr = tk.Frame(dlg, bg=COLOR_PANEL_WARM, padx=14, pady=10, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text="👥 ADD NEW COUNTER CASHIER", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM).pack(anchor="w")
        tk.Label(hdr, text="Cashier will sign in using username 'staff' + this password.", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(anchor="w")

        body = tk.Frame(dlg, bg=COLOR_CANVAS_BG, padx=16, pady=12)
        body.pack(fill=tk.BOTH, expand=True)

        tk.Label(body, text="Cashier Display Name (e.g. Cashier 3 / Maria):", font=("Segoe UI", 8, "bold"), fg=COLOR_TEXT_SECONDARY, bg=COLOR_CANVAS_BG).pack(anchor="w", pady=(0, 4))
        name_entry = tk.Entry(body, width=28, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 10), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        name_entry.insert(0, "Cashier 3")
        name_entry.pack(fill=tk.X, pady=(0, 8))
        name_entry.focus_set()

        tk.Label(body, text="Cashier Password (min 6 chars):", font=("Segoe UI", 8, "bold"), fg=COLOR_TEXT_SECONDARY, bg=COLOR_CANVAS_BG).pack(anchor="w", pady=(0, 4))
        pwd_entry = tk.Entry(body, width=28, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 10), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        pwd_entry.pack(fill=tk.X, pady=(0, 8))

        msg_lbl = tk.Label(body, text="", font=("Segoe UI", 8), fg=COLOR_DANGER_TEXT, bg=COLOR_CANVAS_BG)
        msg_lbl.pack(anchor="w", pady=(0, 8))

        def _add():
            nm = name_entry.get().strip()
            pw = pwd_entry.get().strip()
            if not nm:
                msg_lbl.configure(text="Cashier name is required.", fg=COLOR_DANGER_TEXT)
                return
            if len(pw) < 6:
                msg_lbl.configure(text="Password must be at least 6 characters.", fg=COLOR_DANGER_TEXT)
                return
            msg_lbl.configure(text="Saving cashier to database...", fg=COLOR_WARN_TEXT)
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "add-cashier", nm, "--password-stdin"],
                        cwd=str(API_DIR),
                        input=f"{pw}\n",
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dlg.after(0, lambda: [
                            messagebox.showinfo("Success", f"Cashier '{nm}' added successfully!"),
                            dlg.destroy(),
                            self.load_main_accounts(),
                        ])
                    else:
                        dlg.after(0, lambda: msg_lbl.configure(text=f"Error: {res.stderr or res.stdout}", fg=COLOR_DANGER_TEXT))
                except Exception as exc:
                    dlg.after(0, lambda: msg_lbl.configure(text=f"Error: {exc}", fg=COLOR_DANGER_TEXT))
            threading.Thread(target=_worker, daemon=True).start()

        btn_row = tk.Frame(body, bg=COLOR_CANVAS_BG)
        btn_row.pack(fill=tk.X)
        self._make_button(btn_row, text="Add cashier", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF", command=_add, padx=12, pady=4).pack(side=tk.LEFT)
        self._make_button(btn_row, text="Cancel", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=dlg.destroy, padx=10, pady=4).pack(side=tk.RIGHT)

    # ------------------------------------------------------------------
    # ADVANCED PANEL — TELEMETRY, 4 BOXES, MIGRATION, VAULT & LOGS
    # ------------------------------------------------------------------
    def _build_advanced_panel(self, parent: tk.Widget) -> None:
        """Technical tools page, written for the shop owner: plain words, grouped by what you want to do."""
        scroll_canvas = tk.Canvas(parent, bg=COLOR_CANVAS_BG, highlightthickness=0)
        scroll_bar = tk.Scrollbar(parent, orient=tk.VERTICAL, command=scroll_canvas.yview)
        scroll_canvas.configure(yscrollcommand=scroll_bar.set)
        scroll_bar.pack(side=tk.RIGHT, fill=tk.Y)
        scroll_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        inner = tk.Frame(scroll_canvas, bg=COLOR_CANVAS_BG)
        inner_id = scroll_canvas.create_window((0, 0), window=inner, anchor="nw")
        scroll_canvas.bind("<Configure>", lambda e: scroll_canvas.itemconfig(inner_id, width=e.width))
        inner.bind("<Configure>", lambda e: scroll_canvas.configure(scrollregion=scroll_canvas.bbox("all")))

        def _wheel(event):
            scroll_canvas.yview_scroll(int(-event.delta / 120), "units")

        scroll_canvas.bind("<Enter>", lambda e: scroll_canvas.bind_all("<MouseWheel>", _wheel))
        scroll_canvas.bind("<Leave>", lambda e: scroll_canvas.unbind_all("<MouseWheel>"))
        parent = inner

        head = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        head.pack(fill=tk.X, pady=(4, 12))
        tk.Label(
            head, text="Technical tools", font=("Georgia", 22, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w")
        tk.Label(
            head,
            text="You do not need this page every day. Use it to save a backup, or when the shop system will not start.",
            font=("Segoe UI", 11), fg=COLOR_TEXT_WALNUT, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w", pady=(2, 0))

        # 1. Computer health
        self._adv_section_title(parent, "How the computer is doing")
        self._build_telemetry_panel(parent)

        # 2. The four parts of the shop system
        self._adv_section_title(parent, "Parts of the shop system")
        parts = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        parts.pack(fill=tk.X)
        parts.columnconfigure(0, weight=1)
        for idx, cfg in enumerate(SERVICES_CONFIG):
            self._build_service_card(parts, cfg, idx, 0)

        # 3. Backups and fixes
        self._adv_section_title(parent, "Backups and fixes")
        tools = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        tools.pack(fill=tk.X)
        tools.columnconfigure(0, weight=1, uniform="tools")
        tools.columnconfigure(1, weight=1, uniform="tools")

        def tool_card(row, col, title, desc, buttons, status_attr=None):
            card = tk.Frame(
                tools, bg=COLOR_CARD_DARK, padx=16, pady=12,
                highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
            )
            card.grid(row=row, column=col, sticky="nsew", padx=(0 if col == 0 else 6, 6 if col == 0 else 0), pady=(0, 10))
            tk.Label(card, text=title, font=("Segoe UI", 11, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK).pack(anchor="w")
            tk.Label(
                card, text=desc, font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
                wraplength=430, justify=tk.LEFT,
            ).pack(anchor="w", pady=(2, 8))
            if status_attr:
                lbl = tk.Label(
                    card, text="Checking…", font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT,
                    bg=COLOR_CARD_DARK, wraplength=430, justify=tk.LEFT,
                )
                lbl.pack(anchor="w", pady=(0, 8))
                setattr(self, status_attr, lbl)
            row_btns = tk.Frame(card, bg=COLOR_CARD_DARK)
            row_btns.pack(anchor="w", side=tk.BOTTOM)
            for text, bg, fg, cmd, border in buttons:
                self._make_button(row_btns, text=text, bg=bg, fg=fg, command=cmd, padx=12, pady=6,
                                  border_color=border).pack(side=tk.LEFT, padx=(0, 8))

        tool_card(
            0, 0, "Save a backup of your data",
            "Saves a copy of your sales, menu and stock. A backup is also saved automatically every day.",
            [
                ("Back up now", COLOR_SUCCESS_BTN, "#FFFFFF", self.backup_database_now, None),
                ("Open backups folder", COLOR_PANEL_WARM, COLOR_TEXT_SECONDARY, self.open_vault_backups_folder, COLOR_CARD_BORDER),
            ],
        )
        tool_card(
            0, 1, "The system will not start?",
            "Closes programs that are stuck from last time, so the shop system can start again. Try this before calling for help.",
            [("Fix stuck system", COLOR_PANEL_WARM, COLOR_WARN_TEXT, self._danger_cmd(
                "Fix stuck system?", "This force-closes the shop programs",
                [
                    "Every shop program is closed by force, even ones that are working.",
                    "Anyone using the register or the website is cut off immediately.",
                    "An order being taken right now can be lost.",
                    "Only do this when the shop system will not start.",
                ],
                "Force close and fix", self.free_all_ports), COLOR_CARD_BORDER)],
        )
        tool_card(
            1, 0, "Menu and stock list",
            "Clear them to start fresh. A copy is saved first, so you can bring everything back.",
            [
                ("Clear menu and stock", "#9A3412", "#FFFFFF", self._danger_cmd(
                    "Clear menu and stock?", "Your whole menu and stock list will be emptied",
                    [
                        "Every menu item, recipe and stock item is removed from the live system.",
                        "Customers will see an EMPTY menu until you bring the saved copy back.",
                        "The cashiers cannot sell items that are no longer on the menu.",
                        "A copy is saved first. Sales history and staff accounts are not touched.",
                    ],
                    "Clear menu and stock", self.archive_and_clean_catalog), None),
                ("Bring back saved copy", COLOR_PANEL_WARM, COLOR_TEXT_SECONDARY, self._danger_cmd(
                    "Bring back the saved copy?", "Your current menu and stock list will be replaced",
                    [
                        "The menu and stock list you have right now is replaced by the saved copy.",
                        "Anything you added or changed since the copy was saved disappears from the live list.",
                        "A safety copy of what is there now is kept first.",
                    ],
                    "Bring back saved copy", self.recover_archived_catalog), COLOR_CARD_BORDER),
            ],
            status_attr="vault_status_lbl",
        )
        tool_card(
            1, 1, "After a system update",
            "Your developer will tell you when to press this. It brings the database up to date.",
            [("Update the database", COLOR_PANEL_WARM, COLOR_TEXT_SECONDARY, self._danger_cmd(
                "Update the database?", "This changes how your data is stored",
                [
                    "Your developer should tell you when to do this. If they did not, press Cancel.",
                    "It changes the structure of your database and cannot be undone with one click.",
                    "Save a backup first (Back up now).",
                ],
                "Update the database", self.run_setup_and_migrate), COLOR_CARD_BORDER)],
        )

        # 4. Activity log (for IT support) lives in its own window
        foot = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        foot.pack(fill=tk.X, pady=(0, 6))
        tk.Label(
            foot, text="Need to call for help? Your IT person may ask you to copy the activity log.",
            font=("Segoe UI", 10), fg=COLOR_TEXT_MUTED, bg=COLOR_CANVAS_BG,
        ).pack(side=tk.LEFT)
        self._make_button(
            foot, text="Open activity log", bg=COLOR_PANEL_WARM, fg=COLOR_TEXT_SECONDARY,
            command=self._open_log_window, padx=12, pady=5, border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT)

        self._build_console_panel(parent)

    # ------------------------------------------------------------------
    # OWNER PASSWORD GATE (page unlock and risky actions)
    # ------------------------------------------------------------------
    def _danger_cmd(self, title, headline, warnings, confirm_label, fn):
        """Return a button command that asks for the owner password (with warnings) before running fn."""
        def _run():
            self._admin_gate(title, headline, warnings, confirm_label, fn)
        return _run

    def _admin_gate(
        self,
        title: str,
        headline: str,
        warnings: list[str],
        confirm_label: str,
        on_success,
        require_ack: bool = True,
        danger: bool = True,
    ) -> None:
        existing = getattr(self, "_gate_window", None)
        if existing is not None and existing.winfo_exists():
            existing.lift()
            existing.focus_force()
            return

        accent = STEP_ERROR if danger else COLOR_BRASS
        dlg = tk.Toplevel(self.root)
        self._gate_window = dlg
        dlg.title(title)
        dlg.configure(bg=COLOR_CANVAS_BG)
        dlg.transient(self.root)
        dlg.resizable(False, False)

        top = tk.Frame(dlg, bg=COLOR_PANEL_WARM, padx=20, pady=14)
        top.pack(fill=tk.X)
        tk.Frame(top, height=4, bg=accent).pack(fill=tk.X, pady=(0, 10))
        tk.Label(
            top, text=("Warning" if danger else "Owner only"), font=("Segoe UI", 10, "bold"),
            fg=accent, bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")
        tk.Label(
            top, text=headline, font=("Georgia", 15, "bold"), fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM, wraplength=460, justify=tk.LEFT,
        ).pack(anchor="w", pady=(2, 0))

        body = tk.Frame(dlg, bg=COLOR_CANVAS_BG, padx=20, pady=12)
        body.pack(fill=tk.BOTH, expand=True)

        for line in warnings:
            row = tk.Frame(body, bg=COLOR_CANVAS_BG)
            row.pack(fill=tk.X, pady=2)
            tk.Label(row, text="•", font=("Segoe UI", 11, "bold"), fg=accent, bg=COLOR_CANVAS_BG).pack(side=tk.LEFT, anchor="n", padx=(0, 8))
            tk.Label(
                row, text=line, font=("Segoe UI", 10), fg=COLOR_TEXT_SECONDARY,
                bg=COLOR_CANVAS_BG, wraplength=440, justify=tk.LEFT,
            ).pack(side=tk.LEFT, anchor="w")

        ack_var = tk.BooleanVar(value=not require_ack)
        if require_ack:
            tk.Checkbutton(
                body, text="I understand and I want to continue.", variable=ack_var,
                bg=COLOR_CANVAS_BG, fg=COLOR_TEXT_PRIMARY, selectcolor=COLOR_RECESSED,
                activebackground=COLOR_CANVAS_BG, activeforeground=COLOR_TEXT_PRIMARY,
                font=("Segoe UI", 10, "bold"), command=lambda: refresh(),
            ).pack(anchor="w", pady=(12, 0))

        tk.Label(
            body, text="Type the owner password (the admin password) to continue:",
            font=("Segoe UI", 10, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w", pady=(14, 4))
        pwd_entry = tk.Entry(
            body, show="*", bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY,
            relief=tk.FLAT, font=("Consolas", 11), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
            highlightcolor=COLOR_BRASS,
        )
        pwd_entry.pack(fill=tk.X, ipady=4)
        msg = tk.Label(body, text="", font=("Segoe UI", 10), fg=COLOR_DANGER_TEXT, bg=COLOR_CANVAS_BG,
                       wraplength=460, justify=tk.LEFT)
        msg.pack(anchor="w", pady=(6, 0))

        btns = tk.Frame(body, bg=COLOR_CANVAS_BG)
        btns.pack(fill=tk.X, pady=(12, 0))
        confirm_btn = tk.Button(
            btns, text=confirm_label, font=("Segoe UI", 10, "bold"), relief=tk.FLAT, cursor="hand2",
            bg=COLOR_DANGER_BTN if danger else COLOR_SUCCESS_BTN, fg="#FFFFFF",
            activebackground=COLOR_DANGER_BTN_HOVER if danger else COLOR_SUCCESS_BTN_HOVER,
            activeforeground="#FFFFFF", disabledforeground="#9A8A80", padx=16, pady=7,
        )
        confirm_btn.pack(side=tk.LEFT)
        cancel_btn = self._make_button(
            btns, text="Cancel", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY,
            command=dlg.destroy, padx=16, pady=7, border_color=COLOR_CARD_BORDER,
        )
        cancel_btn.pack(side=tk.RIGHT)

        busy = {"on": False}

        def refresh(*_a) -> None:
            ready = bool(pwd_entry.get()) and ack_var.get() and not busy["on"]
            confirm_btn.configure(state=tk.NORMAL if ready else tk.DISABLED, bg=(
                (COLOR_DANGER_BTN if danger else COLOR_SUCCESS_BTN) if ready else "#3A2E28"))

        def submit(_e=None) -> None:
            if str(confirm_btn["state"]) == "disabled":
                return
            wait = getattr(self, "_gate_locked_until", 0.0) - time.time()
            if wait > 0:
                msg.configure(text=f"Too many wrong tries. Please wait {int(wait) + 1} seconds.")
                return
            pw = pwd_entry.get()
            busy["on"] = True
            refresh()
            msg.configure(text="Checking…", fg=COLOR_WARN_TEXT)

            def _worker() -> None:
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "verify-admin-password", "--password-stdin"],
                        cwd=str(API_DIR), input=pw + chr(10), capture_output=True, text=True, timeout=10,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                    ok = res.returncode == 0
                    err = "" if ok else friendly_error(res)
                except Exception:
                    ok, err = False, "The database is off. Turn on the shop system first, then try again."
                if not dlg.winfo_exists():
                    return
                dlg.after(0, lambda: _done(ok, err))

            def _done(ok: bool, err: str) -> None:
                busy["on"] = False
                if ok:
                    self._gate_fail_count = 0
                    dlg.destroy()
                    on_success()
                    return
                if err.startswith("Incorrect"):
                    self._gate_fail_count = getattr(self, "_gate_fail_count", 0) + 1
                    if self._gate_fail_count >= 5:
                        self._gate_locked_until = time.time() + 60
                        self._gate_fail_count = 0
                        err = "Too many wrong tries. Please wait 60 seconds."
                    else:
                        err = f"That password is not correct. Try again ({5 - self._gate_fail_count} tries left)."
                msg.configure(text=err, fg=COLOR_DANGER_TEXT)
                pwd_entry.delete(0, tk.END)
                refresh()
                pwd_entry.focus_set()

            threading.Thread(target=_worker, daemon=True).start()

        confirm_btn.configure(command=submit)
        pwd_entry.bind("<KeyRelease>", refresh)
        pwd_entry.bind("<Return>", submit)
        dlg.bind("<Escape>", lambda _e: dlg.destroy())
        refresh()

        dlg.update_idletasks()
        self._center_dialog(dlg, max(520, dlg.winfo_reqwidth()), dlg.winfo_reqheight())
        dlg.grab_set()
        pwd_entry.focus_set()

    def _adv_section_title(self, parent: tk.Widget, text: str) -> None:
        tk.Label(
            parent, text=text, font=("Georgia", 13, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_CANVAS_BG,
        ).pack(anchor="w", pady=(4, 6))

    # ------------------------------------------------------------------
    # COMPUTER HEALTH (memory and workload)
    # ------------------------------------------------------------------
    def _build_telemetry_panel(self, parent: tk.Widget) -> None:
        shelf = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        shelf.pack(fill=tk.X, pady=(0, 10))
        shelf.columnconfigure(0, weight=1, uniform="health")
        shelf.columnconfigure(1, weight=1, uniform="health")

        def gauge(col, title, val_attr, canvas_attr, sub_attr, redraw):
            frame = tk.Frame(
                shelf, bg=COLOR_CARD_DARK, padx=16, pady=10,
                highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
            )
            frame.grid(row=0, column=col, sticky="nsew", padx=(0 if col == 0 else 6, 6 if col == 0 else 0))
            top = tk.Frame(frame, bg=COLOR_CARD_DARK)
            top.pack(fill=tk.X)
            tk.Label(top, text=title, font=("Segoe UI", 11, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK).pack(side=tk.LEFT)
            val = tk.Label(top, text="Checking…", font=("Segoe UI", 10, "bold"), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK)
            val.pack(side=tk.RIGHT)
            canvas = tk.Canvas(frame, height=12, bg=COLOR_RECESSED, highlightthickness=0)
            canvas.pack(fill=tk.X, pady=(6, 6))
            canvas.bind("<Configure>", redraw)
            sub = tk.Label(frame, text="", font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK,
                           wraplength=430, justify=tk.LEFT)
            sub.pack(anchor="w")
            setattr(self, val_attr, val)
            setattr(self, canvas_attr, canvas)
            setattr(self, sub_attr, sub)

        gauge(0, "Computer memory", "ram_val_lbl", "ram_canvas", "ram_sub_lbl", self._redraw_ram_meter)
        gauge(1, "Computer workload", "cpu_val_lbl", "cpu_canvas", "cpu_sub_lbl", self._redraw_cpu_meter)

    # ------------------------------------------------------------------
    # ACTIVITY LOG (separate window, for IT support)
    # ------------------------------------------------------------------
    def _build_console_panel(self, parent: tk.Widget) -> None:
        win = tk.Toplevel(self.root)
        win.title("Activity log")
        win.configure(bg=COLOR_CANVAS_BG)
        win.minsize(640, 360)
        win.withdraw()
        win.protocol("WM_DELETE_WINDOW", win.withdraw)
        self.log_window = win

        bar = tk.Frame(win, bg=COLOR_PANEL_WARM, padx=14, pady=10)
        bar.pack(fill=tk.X)
        tk.Label(
            bar, text="Activity log", font=("Georgia", 14, "bold"),
            fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)
        tk.Checkbutton(
            bar, text="Follow newest lines", variable=self.auto_scroll_var,
            bg=COLOR_PANEL_WARM, fg=COLOR_TEXT_SECONDARY, selectcolor=COLOR_RECESSED,
            activebackground=COLOR_PANEL_WARM, activeforeground=COLOR_TEXT_PRIMARY,
            font=("Segoe UI", 9),
        ).pack(side=tk.RIGHT, padx=4)
        self._make_button(
            bar, text="Clear this tab", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY,
            command=self.clear_current_log, padx=10, pady=3, border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT, padx=2)
        self._make_button(
            bar, text="Copy for IT support", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY,
            command=self.copy_current_log, padx=10, pady=3, border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT, padx=2)

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Amaya.TNotebook", background=COLOR_CANVAS_BG, borderwidth=0)
        style.configure(
            "Amaya.TNotebook.Tab", background="#2C1F18", foreground=COLOR_TEXT_WALNUT,
            padding=(12, 5), font=("Segoe UI", 9, "bold"), borderwidth=1,
        )
        style.map(
            "Amaya.TNotebook.Tab",
            background=[("selected", COLOR_ACCENT_LEATHER)],
            foreground=[("selected", "#FFFFFF")],
        )

        self.notebook = ttk.Notebook(win, style="Amaya.TNotebook")
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)

        tabs_spec = [
            ("all", "Everything"),
            ("mysql", "Database"),
            ("api", "Server"),
            ("customer", "Customer site"),
            ("portal", "Register site"),
        ]
        for tab_id, tab_title in tabs_spec:
            tab_frame = tk.Frame(self.notebook, bg=COLOR_TERMINAL_BG)
            self.notebook.add(tab_frame, text=tab_title)

            scrollbar = tk.Scrollbar(tab_frame, orient=tk.VERTICAL)
            text_widget = tk.Text(
                tab_frame, bg=COLOR_TERMINAL_BG, fg=COLOR_TERMINAL_FG, insertbackground="#FFFFFF",
                font=("Consolas", 10), wrap=tk.WORD, yscrollcommand=scrollbar.set,
                padx=8, pady=6, borderwidth=0, state=tk.DISABLED,
            )
            scrollbar.config(command=text_widget.yview)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            text_widget.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

            text_widget.tag_config("timestamp", foreground=COLOR_TEXT_MUTED)
            text_widget.tag_config("prefix_mysql", foreground="#FBBF24", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_api", foreground="#FB923C", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_customer", foreground="#4ADE80", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_portal", foreground="#93C5FD", font=("Consolas", 10, "bold"))
            text_widget.tag_config("prefix_system", foreground=COLOR_BRASS_LIGHT, font=("Consolas", 10, "bold"))
            text_widget.tag_config("error", foreground="#FCA5A5")
            text_widget.tag_config("success", foreground="#86EFAC")
            text_widget.tag_config("warn", foreground="#FDE047")
            text_widget.tag_config("normal", foreground=COLOR_TERMINAL_FG)

            self.log_widgets[tab_id] = text_widget

    def _open_log_window(self) -> None:
        win = self.log_window
        win.update_idletasks()
        self._center_dialog(win, 900, 560)
        win.deiconify()
        win.lift()
        win.focus_set()

    # ------------------------------------------------------------------
    # METER REDRAW HANDLERS (CALLED ON WINDOW RESIZE)
    # ------------------------------------------------------------------
    def _redraw_ram_meter(self, event=None) -> None:
        canvas = getattr(self, "ram_canvas", None)
        if not canvas or not canvas.winfo_exists():
            return
        w = canvas.winfo_width()
        h = canvas.winfo_height()
        canvas.delete("all")
        if w <= 1:
            w = canvas.winfo_reqwidth() or 180
        if h <= 1:
            h = 12
        pct = getattr(self, "ram_pct_val", 0.0)
        canvas.create_rectangle(0, 0, w, h, fill=COLOR_RECESSED, outline="")
        fill_w = max(0, min(w, int(w * (pct / 100.0))))
        if fill_w > 0:
            bar_color = "#4ADE80" if pct < 70 else "#F59E0B" if pct < 85 else "#EF4444"
            canvas.create_rectangle(0, 0, fill_w, h, fill=bar_color, outline="")

    def _redraw_cpu_meter(self, event=None) -> None:
        canvas = getattr(self, "cpu_canvas", None)
        if not canvas or not canvas.winfo_exists():
            return
        w = canvas.winfo_width()
        h = canvas.winfo_height()
        canvas.delete("all")
        if w <= 1:
            w = canvas.winfo_reqwidth() or 180
        if h <= 1:
            h = 12
        pct = getattr(self, "cpu_pct_val", 0.0)
        canvas.create_rectangle(0, 0, w, h, fill=COLOR_RECESSED, outline="")
        fill_w = max(0, min(w, int(w * (pct / 100.0))))
        if fill_w > 0:
            bar_color = "#4ADE80" if pct < 75 else "#F59E0B" if pct < 90 else "#EF4444"
            canvas.create_rectangle(0, 0, fill_w, h, fill=bar_color, outline="")

    # ------------------------------------------------------------------
    # ONE ROW PER PART OF THE SHOP SYSTEM
    # ------------------------------------------------------------------
    def _build_service_card(self, parent: tk.Frame, cfg: dict, row_index: int, col_index: int) -> None:
        sid = cfg["id"]
        plain = {
            "mysql": ("Database", "Stores your sales, menu, stock and accounts."),
            "api": ("Server", "Connects the register and website to the database."),
            "customer": ("Customer site", "The menu page your customers see."),
            "portal": ("Register and admin site", "Where you and your cashiers work."),
        }[sid]

        row = tk.Frame(
            parent, bg=COLOR_CARD_DARK,
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        row.grid(row=row_index, column=0, sticky="ew", pady=(0, 6))
        tk.Frame(row, width=5, bg=cfg.get("accent", COLOR_CARD_BORDER)).pack(side=tk.LEFT, fill=tk.Y)

        body = tk.Frame(row, bg=COLOR_CARD_DARK, padx=14, pady=8)
        body.pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Label(body, text=plain[0], font=("Segoe UI", 11, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_CARD_DARK).pack(anchor="w")
        tk.Label(body, text=plain[1], font=("Segoe UI", 9), fg=COLOR_TEXT_MUTED, bg=COLOR_CARD_DARK).pack(anchor="w")
        meta_lbl = tk.Label(body, text="Not running", font=("Segoe UI", 10), fg=COLOR_TEXT_WALNUT, bg=COLOR_CARD_DARK)
        meta_lbl.pack(anchor="w", pady=(2, 0))

        right = tk.Frame(row, bg=COLOR_CARD_DARK, padx=12)
        right.pack(side=tk.RIGHT, fill=tk.Y)
        right.columnconfigure(4, minsize=170)

        status_badge = tk.Label(
            right, text="● Stopped", font=("Segoe UI", 10, "bold"), width=14,
            fg=COLOR_NEUTRAL_TEXT, bg=COLOR_NEUTRAL_BG, padx=8, pady=4,
        )
        status_badge.grid(row=0, column=0, padx=(0, 12), pady=10)

        def _confirm_stop(s=sid, name=plain[0]):
            extra = (
                ["The database holds everything. Without it, NOTHING in the shop system works."]
                if s == "mysql" else []
            )
            self._admin_gate(
                title=f"Stop the {name.lower()}?",
                headline=f"You are about to stop the {name.lower()}",
                warnings=extra + [
                    "Part of the shop system will stop working right away.",
                    "Cashiers may be signed out, and an order being taken can be lost.",
                    "Customers cannot order until you start it again.",
                ],
                confirm_label=f"Stop the {name.lower()}",
                on_success=lambda: self.stop_service(s),
            )

        start_btn = self._make_button(
            right, text="Start", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF",
            command=lambda s=sid: self.start_service(s), padx=12, pady=5,
        )
        start_btn.grid(row=0, column=1, padx=(0, 4), pady=10)
        stop_btn = self._make_button(
            right, text="Stop", bg=COLOR_DANGER_BTN, fg="#FFFFFF",
            command=_confirm_stop, padx=12, pady=5,
        )
        stop_btn.grid(row=0, column=2, padx=4, pady=10)
        restart_btn = self._make_button(
            right, text="Restart", bg=COLOR_PANEL_WARM, fg=COLOR_TEXT_SECONDARY,
            command=lambda s=sid: self.restart_service(s), padx=12, pady=5,
            border_color=COLOR_CARD_BORDER,
        )
        restart_btn.grid(row=0, column=3, padx=4, pady=10)

        open_label = {"customer": "Open site", "portal": "Open site", "mysql": "Open database viewer"}.get(sid)
        if open_label:
            self._make_button(
                right, text=open_label, bg=COLOR_PANEL_WARM, fg=COLOR_BRASS_LIGHT,
                command=lambda u=cfg["url"]: webbrowser.open(u), padx=12, pady=5,
                border_color=COLOR_CARD_BORDER,
            ).grid(row=0, column=4, padx=(4, 0), pady=10, sticky="w")

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
        pady: int = 5,
        border_color: str | None = None,
    ) -> tk.Button:
        btn = tk.Button(
            parent,
            text=text,
            bg=bg,
            fg=fg,
            activebackground="#4A3427" if bg in (COLOR_CARD_DARK, COLOR_PANEL_WARM) else "#228045" if bg == COLOR_SUCCESS_BTN else "#A82626",
            activeforeground="#FFFFFF",
            font=("Segoe UI", 9, "bold"),
            relief=tk.FLAT,
            highlightthickness=1 if border_color else 0,
            highlightbackground=border_color or bg,
            cursor="hand2",
            padx=padx,
            pady=pady,
            command=command,
        )
        return btn

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
            raw = re.sub(
                r"^DB_USER=amaya_app(?=\r?$)",
                "DB_USER=root",
                raw,
                flags=re.MULTILINE,
            )
            raw = re.sub(
                r"^DB_PASSWORD=replace_with_your_local_mysql_password(?=\r?$)",
                "DB_PASSWORD=",
                raw,
                flags=re.MULTILINE,
            )
            updated, _ = _repair_jwt_secret_in_env(raw)
            env_path.write_text(updated, encoding="utf-8")
            self.enqueue_log(
                "api",
                "success",
                "Created api/.env from .env.example with a 64-char JWT_SECRET.",
            )
            self.enqueue_log(
                "api",
                "warn",
                "Bootstrapped api/.env with local XAMPP defaults (DB_USER=root, empty DB_PASSWORD). "
                "For non-dev or shared environments, provision a dedicated user via "
                "database/setup_app_user.sql and set a strong DB_PASSWORD.",
            )
            return True

        content = env_path.read_text(encoding="utf-8")
        updated, changed = _repair_jwt_secret_in_env(content)
        if changed:
            env_path.write_text(updated, encoding="utf-8")
            self.enqueue_log(
                "api",
                "warn",
                "Replaced missing or weak JWT_SECRET in api/.env with a 64-character random secret.",
            )
        return True

    def _install_dependencies_if_missing(self, target_dir: pathlib.Path, service_id: str) -> bool:
        nm_path = target_dir / "node_modules"
        if nm_path.is_dir():
            return True

        use_ci = (target_dir / "package-lock.json").is_file()
        npm_cmd = "ci" if use_ci else "install"
        self.enqueue_log(
            service_id,
            "warn",
            f"node_modules missing in {target_dir.name}. Running 'npm {npm_cmd}' automatically...",
        )
        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            proc = subprocess.Popen(
                [self.npm_exe, npm_cmd],
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
                self.enqueue_log(service_id, "success", f"npm {npm_cmd} completed in {target_dir.name}!")
                return True
            self.enqueue_log(service_id, "error", f"npm {npm_cmd} failed in {target_dir.name} (code {proc.returncode}).")
            return False
        except Exception as exc:
            self.enqueue_log(service_id, "error", f"Failed to run npm {npm_cmd}: {exc}")
            return False

    def _run_db_backup(self, reason: str, if_older_than_hours: float | None = None) -> bool:
        """
        Run api/src/backup-db.js (mysqldump --single-transaction, verified, rotated).
        Returns True when a verified backup exists afterwards (new or recent enough).
        Blocking; call from a worker thread.
        """
        if not is_port_open(3306):
            self.enqueue_log("mysql", "warn", f"Skipping {reason} backup: MySQL (:3306) is not running.")
            return False
        node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
        cmd = [node_exe, "src/backup-db.js", "--reason", reason]
        if if_older_than_hours is not None:
            cmd += ["--if-older-than-hours", str(if_older_than_hours)]
        with self._backup_lock:
            try:
                res = subprocess.run(
                    cmd,
                    cwd=str(API_DIR),
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=600,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except Exception as exc:
                self.enqueue_log("mysql", "error", f"Database backup ({reason}) could not run: {exc}")
                return False
        output = (res.stdout or "") + (res.stderr or "")
        if res.returncode == 0 and "BACKUP_OK:" in output:
            path = output.split("BACKUP_OK:", 1)[1].strip().splitlines()[0]
            self.enqueue_log("mysql", "success", f"💾 Database backup ({reason}) saved: {path}")
            return True
        if res.returncode == 0 and "BACKUP_SKIPPED:" in output:
            return True
        self.enqueue_log("mysql", "error", f"Database backup ({reason}) FAILED: {output.strip()[-400:]}")
        return False

    def backup_database_now(self) -> None:
        threading.Thread(target=lambda: self._run_db_backup("manual"), daemon=True).start()

    def _daily_backup_loop(self) -> None:
        """Every 30 minutes, take the daily backup if the newest one is older than 20 hours."""
        while not self.is_closing:
            try:
                if is_port_open(3306):
                    self._run_db_backup("daily", if_older_than_hours=20)
            except Exception as exc:
                self.enqueue_log("mysql", "warn", f"Daily backup check failed: {exc}")
            for _ in range(30 * 60):
                if self.is_closing:
                    return
                time.sleep(1)

    def _schedule_migration_offer(self, pending: list[str]) -> None:
        """Called from the health thread: ask once (on the UI thread) per distinct pending set."""
        key = tuple(pending)
        if not key or self._migration_running or self._migration_offered_for == key or self.is_closing:
            return
        self._migration_offered_for = key
        self.root.after(0, lambda: self._offer_pending_migrations(list(key)))

    def _offer_pending_migrations(self, pending: list[str]) -> None:
        names = "\n".join(f"  • {name}" for name in pending)
        self.enqueue_log(
            "api", "warn",
            f"Database is missing {len(pending)} update(s): {', '.join(pending)}. 'Update the database' applies them after a backup.",
        )
        if messagebox.askyesno(
            "Database update needed",
            f"The shop system was updated and the database needs {len(pending)} update(s) to match:\n\n{names}\n\n"
            "Until then, pages that use them (dashboard, settings, finances) will show errors.\n\n"
            "Back up the database and apply the update(s) now?",
        ):
            self.run_setup_and_migrate()
        else:
            self.enqueue_log("api", "info", "Database update postponed. Press 'Update the database' (After a system update) when ready.")

    def run_setup_and_migrate(self) -> None:
        if self._migration_running:
            self.enqueue_log("api", "warn", "A database update is already running.")
            return
        self._migration_running = True

        def _finish() -> None:
            self._migration_running = False
            # Re-check health now instead of showing a stale badge for up to 5 seconds.
            self._last_api_health_time = 0.0

        def _worker() -> None:
            try:
                _run()
            finally:
                _finish()

        def _run() -> None:
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

            if not self._run_db_backup("pre-migrate"):
                self.enqueue_log("api", "error", "Migration cancelled: could not take a verified backup first.")
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

    def _ensure_api_stopped_for_vault(self) -> bool:
        api_proc = self.processes.get("api")
        if not is_port_open(3001) and (api_proc is None or api_proc.poll() is not None):
            return True
        self.enqueue_log("api", "warn", "Backend API (:3001) is active. Stopping API cleanly before Vault maintenance...")
        self._stop_service_worker("api")
        for _ in range(16):
            if not is_port_open(3001):
                break
            time.sleep(0.25)
        return not is_port_open(3001)

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
            backup_str = f"{b_menu} menu items and {b_inv} stock items (saved {b_ts})"
        else:
            backup_str = "none yet. One is made when you press Clear menu and stock."

        text = f"Right now: {live_menu} menu items and {live_inv} stock items.\nSaved copy: {backup_str}"
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
                backup_txt = f"{b_menu} menu items and {b_inv} stock items" if has_b else "none yet"
                msg = f"Right now: turn on the shop system to see this.\nSaved copy: {backup_txt}"
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
            "Clear menu and stock?",
            "This will:\n\n"
            "1. Save a copy of your current menu items, recipes and stock list.\n"
            "2. Empty the menu and stock list, so you can start fresh.\n\n"
            "Your sales history and staff accounts are not touched.\n"
            "You can bring everything back later with the Bring back saved copy button.\n\n"
            "Clear the menu and stock now?",
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

            if not self._ensure_api_stopped_for_vault():
                self.enqueue_log("api", "error", "Cannot run Catalog Vault while Backend API (:3001) is still active.")
                self.root.after(
                    0,
                    lambda: messagebox.showerror(
                        "Backend API Active",
                        "Could not stop Backend API on port 3001. Stop Backend API manually before running Archive & Clean.",
                    ),
                )
                return

            if not self._run_db_backup("pre-vault"):
                self.enqueue_log("api", "error", "Archive & Clean cancelled: could not take a verified backup first.")
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
                "No saved copy yet",
                "There is no saved copy of the menu and stock yet.\n\n"
                "Press Clear menu and stock first. It saves a copy before clearing.",
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
            "Bring back the saved copy?",
            f"This puts your saved menu and stock list back.\n\n"
            f"Saved on: {b_ts}\n"
            f"Menu items: {b_menu}\n"
            f"Stock items: {b_inv}\n\n"
            f"What is there now is saved first, so nothing is lost.\n\n"
            f"Bring it back now?",
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

            if not self._ensure_api_stopped_for_vault():
                self.enqueue_log("api", "error", "Cannot run Catalog Vault recovery while Backend API (:3001) is active.")
                self.root.after(
                    0,
                    lambda: messagebox.showerror(
                        "Backend API Active",
                        "Could not stop Backend API on port 3001. Stop Backend API manually before running Catalog Recovery.",
                    ),
                )
                return

            if not self._run_db_backup("pre-vault"):
                self.enqueue_log("api", "error", "Catalog Recovery cancelled: could not take a verified backup first.")
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
        dialog.title("Team accounts")
        self._center_dialog(dialog, 780, 640)
        dialog.minsize(700, 520)
        dialog.configure(bg=COLOR_CANVAS_BG)
        dialog.transient(self.root)

        # Header Frame
        hdr = tk.Frame(dialog, bg=COLOR_PANEL_WARM, padx=16, pady=12, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        hdr.pack(fill=tk.X)
        tk.Label(
            hdr,
            text="Team accounts",
            font=("Georgia", 15, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")
        tk.Label(
            hdr,
            text="You sign in with the username admin. Each cashier signs in with the username staff and their own password.",
            font=("Segoe UI", 10),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w", pady=(2, 0))

        # Status / Feedback label
        status_lbl = tk.Label(
            dialog,
            text="",
            font=("Segoe UI", 9, "bold"),
            fg=COLOR_SUCCESS_TEXT,
            bg=COLOR_CANVAS_BG,
        )
        status_lbl.pack(fill=tk.X, padx=16, pady=(6, 2))

        def show_status(msg: str, is_error: bool = False, neutral: bool = False) -> None:
            colour = COLOR_DANGER_TEXT if is_error else (COLOR_WARN_TEXT if neutral else COLOR_SUCCESS_TEXT)
            status_lbl.configure(text=msg, fg=colour)

        # Main Body
        body = tk.Frame(dialog, bg=COLOR_CANVAS_BG, padx=16, pady=4)
        body.pack(fill=tk.BOTH, expand=True)

        # --- Card 1: Admin / Owner ---
        admin_card = tk.LabelFrame(
            body,
            text=" Owner (you) ",
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_PRIMARY,
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=8,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        admin_card.pack(fill=tk.X, pady=(0, 10))

        admin_info = tk.Frame(admin_card, bg=COLOR_PANEL_WARM)
        admin_info.pack(fill=tk.X, pady=(0, 6))
        tk.Label(
            admin_info,
            text="Username: admin (cannot be changed)",
            font=("Segoe UI", 10, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)
        tk.Label(
            admin_info,
            text="Full access: sales, reports and stock",
            font=("Segoe UI", 9),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT, padx=12)

        admin_current_row = tk.Frame(admin_card, bg=COLOR_PANEL_WARM)
        admin_current_row.pack(fill=tk.X, pady=(0, 6))
        tk.Label(
            admin_current_row, text="Current password:", font=("Segoe UI", 9), width=16, anchor="w",
            fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT, padx=(0, 8))
        admin_current_entry = tk.Entry(
            admin_current_row, show="*", width=24, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY,
            insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 9),
            highlightthickness=1, highlightbackground=COLOR_CARD_BORDER,
        )
        admin_current_entry.pack(side=tk.LEFT)

        admin_input_row = tk.Frame(admin_card, bg=COLOR_PANEL_WARM)
        admin_input_row.pack(fill=tk.X)
        tk.Label(
            admin_input_row,
            text="New password:",
            font=("Segoe UI", 9),
            width=16,
            anchor="w",
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT, padx=(0, 8))

        admin_pwd_entry = tk.Entry(
            admin_input_row,
            show="*",
            width=24,
            bg=COLOR_RECESSED,
            fg=COLOR_TEXT_PRIMARY,
            insertbackground=COLOR_TEXT_PRIMARY,
            relief=tk.FLAT,
            font=("Consolas", 9),
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
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
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_WALNUT,
            selectcolor=COLOR_RECESSED,
            activebackground=COLOR_PANEL_WARM,
            activeforeground=COLOR_TEXT_PRIMARY,
            font=("Segoe UI", 8),
        ).pack(side=tk.LEFT, padx=(0, 10))

        def save_admin_pwd():
            new_p = admin_pwd_entry.get().strip()
            cur_p = admin_current_entry.get()
            if not cur_p:
                show_status("Enter your current password first.", is_error=True)
                return
            if len(new_p) < 8:
                show_status("The new password must be at least 8 characters.", is_error=True)
                return
            show_status("Saving…", neutral=True)
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "set-admin-password", "--password-stdin"],
                        cwd=str(API_DIR),
                        input=f"{cur_p}\n{new_p}\n",
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dialog.after(0, lambda: [show_status("Your password was changed."), admin_pwd_entry.delete(0, tk.END), admin_current_entry.delete(0, tk.END)])
                    else:
                        dialog.after(0, lambda: show_status(friendly_error(res), is_error=True))
                except Exception as exc:
                    dialog.after(0, lambda: show_status("Something went wrong. Please try again.", is_error=True))
            threading.Thread(target=_worker, daemon=True).start()

        self._make_button(
            admin_input_row,
            text="Save new password",
            bg=COLOR_ACCENT_MOCHA,
            fg="#FFFFFF",
            command=save_admin_pwd,
            padx=10,
            pady=3,
        ).pack(side=tk.LEFT)

        # --- Card 2: Cashier Team (Staff Accounts) ---
        cashier_card = tk.LabelFrame(
            body,
            text=" Cashiers ",
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_PRIMARY,
            font=("Segoe UI", 9, "bold"),
            padx=12,
            pady=8,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        cashier_card.pack(fill=tk.BOTH, expand=True)

        tk.Label(
            cashier_card,
            text="The register knows who is working by the password they type in, so give each cashier a different one.",
            font=("Segoe UI", 9),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w", pady=(0, 6))

        # Add Cashier Row
        add_frame = tk.Frame(cashier_card, bg=COLOR_PANEL_WARM, pady=4)
        add_frame.pack(fill=tk.X, pady=(0, 8))
        tk.Label(add_frame, text="Name:", font=("Segoe UI", 9), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
        new_name_entry = tk.Entry(
            add_frame,
            width=16,
            bg=COLOR_RECESSED,
            fg=COLOR_TEXT_PRIMARY,
            insertbackground=COLOR_TEXT_PRIMARY,
            relief=tk.FLAT,
            font=("Consolas", 9),
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        new_name_entry.pack(side=tk.LEFT, padx=(0, 8))

        tk.Label(add_frame, text="Password (6 or more characters):", font=("Segoe UI", 9), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
        new_pwd_entry = tk.Entry(
            add_frame,
            width=16,
            bg=COLOR_RECESSED,
            fg=COLOR_TEXT_PRIMARY,
            insertbackground=COLOR_TEXT_PRIMARY,
            relief=tk.FLAT,
            font=("Consolas", 9),
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        new_pwd_entry.pack(side=tk.LEFT, padx=(0, 8))

        def add_new_cashier():
            name = new_name_entry.get().strip()
            pwd = new_pwd_entry.get().strip()
            if not name or len(pwd) < 6:
                show_status("Type a name and a password of at least 6 characters.", is_error=True)
                return
            show_status(f"Adding {name}…", neutral=True)
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "add-cashier", name, "--password-stdin"],
                        cwd=str(API_DIR),
                        input=f"{pwd}\n",
                        capture_output=True,
                        text=True,
                        creationflags=creationflags,
                    )
                    if res.returncode == 0:
                        dialog.after(0, lambda: [show_status(f"{name} was added."), new_pwd_entry.delete(0, tk.END), reload_cashiers()])
                    else:
                        dialog.after(0, lambda: show_status(friendly_error(res), is_error=True))
                except Exception as exc:
                    dialog.after(0, lambda: show_status("Something went wrong. Please try again.", is_error=True))
            threading.Thread(target=_worker, daemon=True).start()

        self._make_button(
            add_frame,
            text="Add cashier",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=add_new_cashier,
            padx=10,
            pady=3,
        ).pack(side=tk.LEFT)

        # Cashiers list container
        list_container = tk.Frame(cashier_card, bg=COLOR_RECESSED, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        list_container.pack(fill=tk.BOTH, expand=True, pady=(4, 0))

        cashiers_canvas = tk.Canvas(list_container, bg=COLOR_RECESSED, highlightthickness=0)
        cashiers_scroll = tk.Scrollbar(list_container, orient=tk.VERTICAL, command=cashiers_canvas.yview)
        cashiers_canvas.configure(yscrollcommand=cashiers_scroll.set)
        cashiers_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        cashiers_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        list_frame = tk.Frame(cashiers_canvas, bg=COLOR_RECESSED)
        canvas_window = cashiers_canvas.create_window((0, 0), window=list_frame, anchor="nw")

        def _on_canvas_configure(event):
            cashiers_canvas.itemconfig(canvas_window, width=event.width)
        cashiers_canvas.bind("<Configure>", _on_canvas_configure)
        list_frame.bind("<Configure>", lambda e: cashiers_canvas.configure(scrollregion=cashiers_canvas.bbox("all")))

        def reload_cashiers():
            for w in list_frame.winfo_children():
                w.destroy()
            show_status("Loading cashiers…", neutral=True)
            def _worker():
                node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    res = subprocess.run(
                        [node_exe, "src/account-manager.js", "list"],
                        cwd=str(API_DIR),
                        capture_output=True,
                        text=True,
                        timeout=8,
                        creationflags=creationflags,
                    )
                    accounts = None
                    for line in (res.stdout or "").splitlines():
                        if line.startswith("ACCOUNTS_JSON:"):
                            accounts = json.loads(line[len("ACCOUNTS_JSON:"):])
                            break
                    if accounts is None:
                        dialog.after(0, lambda: render_cashier_rows(None))
                    else:
                        dialog.after(0, lambda: render_cashier_rows(accounts))
                except Exception:
                    dialog.after(0, lambda: render_cashier_rows(None))
            threading.Thread(target=_worker, daemon=True).start()

        def render_cashier_rows(accounts):
            for w in list_frame.winfo_children():
                w.destroy()

            if accounts is None:
                show_status("Cannot load cashiers.", is_error=True)
                tk.Label(
                    list_frame,
                    text="The database is off, so the cashier list is not available.\nClose this window, turn on the shop system, then open this window again.",
                    fg=COLOR_WARN_TEXT, bg=COLOR_RECESSED, font=("Segoe UI", 10), justify=tk.LEFT,
                ).pack(pady=16, padx=12, anchor="w")
                return

            staff_list = [a for a in accounts if a.get("role") == "staff"]
            show_status("")
            if not staff_list:
                tk.Label(list_frame, text="No cashiers yet. Type a name and password above, then press Add cashier.", fg=COLOR_TEXT_MUTED, bg=COLOR_RECESSED, font=("Segoe UI", 10)).pack(pady=16)
                return

            for idx, staff in enumerate(staff_list):
                row_bg = COLOR_PANEL_WARM if idx % 2 == 0 else COLOR_CARD_DARK
                row = tk.Frame(list_frame, bg=row_bg, padx=10, pady=8, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
                row.pack(fill=tk.X, padx=4, pady=2)

                left = tk.Frame(row, bg=row["bg"])
                left.pack(side=tk.LEFT)
                name_lbl = tk.Label(left, text=staff.get('displayName') or f"Cashier {staff.get('id')}", font=("Segoe UI", 10, "bold"), fg=COLOR_TEXT_PRIMARY, bg=row["bg"])
                name_lbl.pack(anchor="w")
                sub_lbl = tk.Label(
                    left,
                    text="Can sign in" if staff.get("isActive") else "Turned off (cannot sign in)",
                    font=("Segoe UI", 9),
                    fg=COLOR_SUCCESS_TEXT if staff.get("isActive") else COLOR_DANGER_TEXT,
                    bg=row["bg"],
                )
                sub_lbl.pack(anchor="w")

                right = tk.Frame(row, bg=row["bg"])
                right.pack(side=tk.RIGHT)

                tk.Label(right, text="New password:", font=("Segoe UI", 9), fg=COLOR_TEXT_WALNUT, bg=row["bg"]).pack(side=tk.LEFT, padx=(0, 4))
                new_pwd_entry = tk.Entry(
                    right,
                    width=14,
                    show="*",
                    bg=COLOR_RECESSED,
                    fg=COLOR_TEXT_PRIMARY,
                    insertbackground=COLOR_TEXT_PRIMARY,
                    relief=tk.FLAT,
                    font=("Consolas", 8),
                    highlightthickness=1,
                    highlightbackground=COLOR_CARD_BORDER,
                )
                new_pwd_entry.pack(side=tk.LEFT, padx=(0, 6))

                def make_update_pwd_cmd(s_id, s_name, entry_widget):
                    def _update():
                        p = entry_widget.get().strip()
                        if len(p) < 6:
                            show_status(f"{s_name}'s new password must be at least 6 characters.", is_error=True)
                            return
                        show_status(f"Saving {s_name}'s password…", neutral=True)
                        def _w():
                            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                            res = subprocess.run([node_exe, "src/account-manager.js", "set-cashier-password", str(s_id), "--password-stdin"], cwd=str(API_DIR), input=f"{p}\n", capture_output=True, text=True, creationflags=creationflags)
                            if res.returncode == 0:
                                dialog.after(0, lambda: [show_status(f"{s_name}'s password was changed."), entry_widget.delete(0, tk.END)])
                            else:
                                dialog.after(0, lambda: show_status(friendly_error(res), is_error=True))
                        threading.Thread(target=_w, daemon=True).start()
                    return _update

                self._make_button(right, text="Change password", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=make_update_pwd_cmd(staff.get("id"), staff.get("displayName"), new_pwd_entry), padx=6, pady=2, border_color=COLOR_CARD_BORDER).pack(side=tk.LEFT, padx=(0, 4))

                def make_toggle_cmd(s_id, s_name):
                    def _toggle():
                        show_status(f"Updating {s_name}…", neutral=True)
                        def _w():
                            node_exe = shutil.which("node.exe") or shutil.which("node") or "node"
                            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                            res = subprocess.run([node_exe, "src/account-manager.js", "toggle-cashier", str(s_id)], cwd=str(API_DIR), capture_output=True, text=True, creationflags=creationflags)
                            if res.returncode == 0:
                                dialog.after(0, lambda: reload_cashiers())
                            else:
                                dialog.after(0, lambda: show_status(friendly_error(res), is_error=True))
                        threading.Thread(target=_w, daemon=True).start()
                    return _toggle

                self._make_button(
                    right,
                    text="Turn off" if staff.get("isActive") else "Turn on",
                    bg=COLOR_DANGER_BTN if staff.get("isActive") else COLOR_SUCCESS_BTN,
                    fg="#FFFFFF",
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
        svc_lock = self._service_locks.get(service_id, self._state_lock)
        with svc_lock:
            return self._start_service_worker_locked(service_id)

    def _start_service_worker_locked(self, service_id: str) -> bool:
        cfg = self._get_service_config(service_id)
        port = cfg["port"]

        # Special handling for XAMPP MySQL (:3306)
        if service_id == "mysql":
            if is_port_open(3306):
                pids = find_pids_on_port(3306)
                with self._state_lock:
                    self.service_states["mysql"] = "RUNNING"
                self.enqueue_log(
                    "mysql",
                    "success",
                    f"MySQL is already running on Port :3306 (PID {pids[0] if pids else 'Active'}).",
                )
                return True

            # A mysqld that is still in crash recovery has not opened :3306 yet.
            # Launching a second one on the same data folder is dangerous, so wait instead.
            running_pids = find_mysqld_pids()
            if running_pids:
                with self._state_lock:
                    self.service_states["mysql"] = "STARTING"
                self.enqueue_log(
                    "mysql",
                    "info",
                    f"mysqld.exe is already running (PID {running_pids[0]}) but not ready yet. Waiting for it...",
                )
                deadline = time.time() + MYSQL_STARTUP_WAIT_SECONDS
                while time.time() < deadline and find_mysqld_pids() and not is_port_open(3306):
                    time.sleep(1)
                if is_port_open(3306):
                    with self._state_lock:
                        self.service_states["mysql"] = "RUNNING"
                    self.enqueue_log("mysql", "success", "MySQL finished starting and is ready on Port :3306.")
                    return True
                if find_mysqld_pids():
                    with self._state_lock:
                        self.service_states["mysql"] = "ERROR"
                    self.enqueue_log(
                        "mysql",
                        "error",
                        "MySQL is still starting after a long wait. Check C:\\xampp\\mysql\\data\\mysql_error.log.",
                    )
                    return False
                self.enqueue_log("mysql", "warn", "The previous mysqld.exe exited. Starting a fresh one...")

            if not XAMPP_MYSQLD.is_file():
                with self._state_lock:
                    self.service_states["mysql"] = "ERROR"
                self.enqueue_log(
                    "mysql",
                    "error",
                    f"XAMPP mysqld.exe not found at {XAMPP_MYSQLD}. Please start your MySQL server manually.",
                )
                return False

            service_state = mysql_service_state()
            if service_state is not None:
                # Installed as a Windows service: let Windows own the process so it is
                # shut down cleanly on PC shutdown/updates.
                with self._state_lock:
                    self.stop_requested["mysql"] = False
                    self.service_states["mysql"] = "STARTING"
                self.enqueue_log("mysql", "info", f"Starting MySQL Windows service '{MYSQL_SERVICE_NAME}' (was {service_state})...")
                res = subprocess.run(
                    ["sc", "start", MYSQL_SERVICE_NAME],
                    capture_output=True,
                    text=True,
                    timeout=15,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if res.returncode == 0 or "1056" in (res.stdout or ""):  # 1056 = already running
                    return True
                self.enqueue_log(
                    "mysql",
                    "warn",
                    "Could not start the MySQL service (Windows may need Administrator rights): "
                    f"{(res.stdout or res.stderr).strip()[-200:]}. Starting MySQL from the panel instead.",
                )

            with self._state_lock:
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
                with self._state_lock:
                    self.processes["mysql"] = proc
                threading.Thread(
                    target=self._read_process_output,
                    args=("mysql", proc),
                    daemon=True,
                ).start()
                return True
            except Exception as exc:
                with self._state_lock:
                    self.service_states["mysql"] = "ERROR"
                self.enqueue_log("mysql", "error", f"Failed to start XAMPP MySQL: {exc}")
                return False

        # Standard Node/Vite services (api, customer, portal)
        with self._state_lock:
            existing_proc = self.processes.get(service_id)
        if existing_proc is not None and existing_proc.poll() is None:
            self.enqueue_log(service_id, "warn", f"{cfg['short_name']} is already running (PID {existing_proc.pid}).")
            return True

        if service_id == "api":
            self._ensure_api_env_file()
            if not self._install_dependencies_if_missing(API_DIR, "api"):
                with self._state_lock:
                    self.service_states[service_id] = "ERROR"
                return False
        else:
            if not self._install_dependencies_if_missing(ROOT_DIR, service_id):
                with self._state_lock:
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

        with self._state_lock:
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
            with self._state_lock:
                self.processes[service_id] = proc
        except Exception as exc:
            with self._state_lock:
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
            self._on_process_output_closed(service_id, proc, cfg)

    def _on_process_output_closed(self, service_id: str, proc: subprocess.Popen, cfg: dict) -> None:
        rc = proc.poll()
        if service_id == "mysql" and rc is None:
            # mysqld writes to mysql_error.log, so its stdout closes early while the
            # server keeps running. Keep tracking it instead of reporting an exit.
            return
        with self._state_lock:
            if self.processes.get(service_id) is proc:
                self.processes[service_id] = None
            was_stopped = self.stop_requested.get(service_id)
            if was_stopped:
                self.service_states[service_id] = "STOPPED"
            else:
                self.service_states[service_id] = "ERROR" if (rc and rc != 0) else "STOPPED"
        if was_stopped:
            self.enqueue_log(service_id, "info", f"{cfg['short_name']} stopped.")
        else:
            self.enqueue_log(
                service_id,
                "error" if (rc and rc != 0) else "warn",
                f"{cfg['short_name']} exited (code {rc}).",
            )

    def stop_service(self, service_id: str) -> None:
        threading.Thread(target=self._stop_service_worker, args=(service_id,), daemon=True).start()

    def _stop_service_worker(self, service_id: str) -> None:
        svc_lock = self._service_locks.get(service_id, self._state_lock)
        with svc_lock:
            cfg = self._get_service_config(service_id)
            with self._state_lock:
                self.stop_requested[service_id] = True
                proc = self.processes.get(service_id)

            if service_id == "mysql":
                # Never taskkill mysqld: a force-kill mid-flush corrupts InnoDB tables.
                self._shutdown_mysql_gracefully()
                with self._state_lock:
                    self.processes["mysql"] = None
                    self.service_states["mysql"] = "RUNNING" if find_mysqld_pids() else "STOPPED"
                return

            if proc is not None and proc.poll() is None:
                pid = proc.pid
                self.enqueue_log(service_id, "info", f"Stopping {cfg['short_name']} process tree (PID {pid})...")
                kill_process_tree(pid)
                with self._state_lock:
                    self.processes[service_id] = None

            port_pids = find_pids_on_port(cfg["port"])
            for pid in port_pids:
                self.enqueue_log(service_id, "info", f"Releasing port :{cfg['port']} (PID {pid})...")
                kill_process_tree(pid)

            with self._state_lock:
                self.service_states[service_id] = "STOPPED"

    def _run_mysqladmin_shutdown(self) -> bool:
        if not XAMPP_MYSQLADMIN.is_file():
            self.enqueue_log("mysql", "error", f"mysqladmin.exe not found at {XAMPP_MYSQLADMIN}.")
            return False
        env_vars = _read_env_file(API_DIR / ".env")
        db_user = env_vars.get("DB_USER") or "root"
        db_password = env_vars.get("DB_PASSWORD", "")
        run_env = {**os.environ, "MYSQL_PWD": db_password} if db_password else None
        try:
            res = subprocess.run(
                [str(XAMPP_MYSQLADMIN), "-u", db_user, "-h", "127.0.0.1", "shutdown"],
                capture_output=True,
                text=True,
                timeout=30,
                env=run_env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception as exc:
            self.enqueue_log("mysql", "warn", f"mysqladmin shutdown failed: {exc}")
            return False
        if res.returncode != 0:
            self.enqueue_log("mysql", "warn", f"mysqladmin shutdown failed: {(res.stderr or res.stdout).strip()}")
            return False
        return True

    def _shutdown_mysql_gracefully(self) -> bool:
        """
        Stop mysqld ONLY through `mysqladmin shutdown` and wait for the process to fully exit.
        Never force-kills: if MySQL does not stop, it is left running and the user is told.
        """
        if not find_mysqld_pids():
            if is_port_open(3306):
                self.enqueue_log("mysql", "warn", "Port :3306 is open but no XAMPP mysqld.exe found; leaving it alone.")
            else:
                self.enqueue_log("mysql", "info", "MySQL is not running.")
            return True

        # mysqladmin can only connect once :3306 is open. If mysqld is still in
        # crash recovery, wait for it instead of killing it mid-recovery.
        if not is_port_open(3306):
            self.enqueue_log("mysql", "info", "MySQL is still starting (crash recovery?). Waiting for it before shutting down...")
            deadline = time.time() + MYSQL_STARTUP_WAIT_SECONDS
            while time.time() < deadline and find_mysqld_pids() and not is_port_open(3306):
                time.sleep(1)
            if not find_mysqld_pids():
                self.enqueue_log("mysql", "info", "MySQL exited on its own.")
                return True
            if not is_port_open(3306):
                self.enqueue_log(
                    "mysql",
                    "error",
                    "MySQL is still not accepting connections. NOT force-killing it (that corrupts tables). "
                    "Wait for it to finish, then press Stop again.",
                )
                return False

        self.enqueue_log("mysql", "info", "Shutting down XAMPP MySQL cleanly via mysqladmin (this can take a while)...")
        if not self._run_mysqladmin_shutdown():
            self.enqueue_log(
                "mysql",
                "error",
                "Could not ask MySQL to shut down. It is left running to protect your data; "
                "stop it from the XAMPP Control Panel instead.",
            )
            return False

        deadline = time.time() + MYSQL_SHUTDOWN_WAIT_SECONDS
        last_note = time.time()
        while time.time() < deadline:
            if not find_mysqld_pids():
                self.enqueue_log("mysql", "success", "MySQL shut down cleanly. All data flushed to disk.")
                return True
            if time.time() - last_note >= 15:
                self.enqueue_log("mysql", "info", "Still flushing data to disk... please don't close the panel or turn off the PC.")
                last_note = time.time()
            time.sleep(0.5)

        self.enqueue_log(
            "mysql",
            "error",
            f"MySQL is still shutting down after {MYSQL_SHUTDOWN_WAIT_SECONDS}s. NOT force-killing it. "
            "Let it finish before turning off the PC.",
        )
        return False

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
        # Keep only the newest lines so a panel left open for days doesn't grow without limit.
        line_count = int(widget.index("end-1c").split(".")[0])
        if line_count > MAX_LOG_LINES_PER_TAB:
            widget.delete("1.0", f"{line_count - MAX_LOG_LINES_PER_TAB + 1}.0")
        if self.auto_scroll_var.get():
            widget.see(tk.END)
        widget.configure(state=tk.DISABLED)

    def _poll_service_health(self) -> None:
        if self.is_closing:
            return

        def _check_all() -> None:
            updates: dict[str, tuple[str, str, str, str]] = {}
            port_status: dict[int, bool] = {}
            mysql_open = is_port_open(3306)

            # 1. Hardware Telemetry Data Gathering (RAM, CPU, and Cores)
            ram_info = {"pct": 0.0, "used_gb": 0.0, "total_gb": 0.0, "free_gb": 0.0}
            cpu_info = {"pct": 0.0, "cores": os.cpu_count() or 4}
            try:
                import psutil
                vm = psutil.virtual_memory()
                ram_info["pct"] = round(vm.percent, 1)
                ram_info["used_gb"] = round(vm.used / (1024**3), 1)
                ram_info["total_gb"] = round(vm.total / (1024**3), 1)
                ram_info["free_gb"] = round(vm.available / (1024**3), 1)
                cpu_info["pct"] = round(psutil.cpu_percent(interval=None), 1)
                cpu_info["cores"] = psutil.cpu_count(logical=True) or 4
            except Exception:
                try:
                    import ctypes
                    class MEMORYSTATUSEX(ctypes.Structure):
                        _fields_ = [
                            ("dwLength", ctypes.c_ulong),
                            ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong),
                            ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                        ]
                    stat = MEMORYSTATUSEX()
                    stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                    ram_info["pct"] = float(stat.dwMemoryLoad)
                    ram_info["total_gb"] = round(stat.ullTotalPhys / (1024**3), 1)
                    ram_info["used_gb"] = round((stat.ullTotalPhys - stat.ullAvailPhys) / (1024**3), 1)
                    ram_info["free_gb"] = round(stat.ullAvailPhys / (1024**3), 1)
                    if hasattr(os, "getloadavg"):
                        load_1m = os.getloadavg()[0]
                        cpu_info["pct"] = round(min(100.0, (load_1m / max(1, cpu_info["cores"])) * 100.0), 1)
                    else:
                        cpu_info["pct"] = 0.0
                except Exception:
                    pass

            # 2. Service & Port Health Checks
            for cfg in SERVICES_CONFIG:
                sid = cfg["id"]
                port = cfg["port"]
                with self._state_lock:
                    proc = self.processes.get(sid)
                    current_state = self.service_states.get(sid)
                port_open = mysql_open if sid == "mysql" else is_port_open(port)
                port_status[port] = port_open
                meta_override: str | None = None

                if proc is not None and proc.poll() is None:
                    pid_str = str(proc.pid)
                elif port_open:
                    pids = find_pids_on_port(port)
                    pid_str = str(pids[0]) if pids else "Active"
                else:
                    pid_str = "—"

                if sid == "mysql":
                    if port_open:
                        badge_text = "● Running"
                        badge_style = "RUNNING"
                        health_detail = "Listening on 127.0.0.1:3306"
                        with self._state_lock:
                            self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● Starting"
                        badge_style = "STARTING"
                        health_detail = "Initializing InnoDB..."
                    else:
                        badge_text = "● Stopped"
                        badge_style = "STOPPED"
                        health_detail = "Offline (Click Start All)"
                elif sid == "api":
                    if port_open:
                        if not mysql_open:
                            badge_text = "● Waiting"
                            badge_style = "WARN"
                            health_detail = "Waiting for MySQL (:3306)"
                            with self._state_lock:
                                self.service_states[sid] = "WARN"
                        else:
                            now = time.time()
                            if now - self._last_api_health_time >= 5.0:
                                self._cached_api_health = check_api_health()
                                self._last_api_health_time = now
                            health_state, health_detail, pending = self._cached_api_health
                            if health_state == "ok":
                                badge_text = "● Running"
                                badge_style = "RUNNING"
                                with self._state_lock:
                                    self.service_states[sid] = "RUNNING"
                            elif health_state == "migrations":
                                # The server is fine; the database is older than the code.
                                badge_text = "● Update needed"
                                badge_style = "WARN"
                                meta_override = (
                                    "Applying the database update…" if self._migration_running
                                    else f"Database is missing {len(pending)} update(s). Press 'Update the database' (it backs up first). Restart will not fix this."
                                )
                                with self._state_lock:
                                    self.service_states[sid] = "WARN"
                                self._schedule_migration_offer(pending)
                            elif health_state == "db_error":
                                badge_text = "● Check needed"
                                badge_style = "WARN"
                                meta_override = f"Running, but cannot use the database: {health_detail}"
                                with self._state_lock:
                                    self.service_states[sid] = "WARN"
                            else:
                                badge_text = "● Not responding"
                                badge_style = "WARN"
                                meta_override = "Running, but not answering. Try Restart."
                                with self._state_lock:
                                    self.service_states[sid] = "WARN"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● Starting"
                        badge_style = "STARTING"
                        health_detail = "Booting Express..."
                    elif current_state == "ERROR":
                        badge_text = "● Problem"
                        badge_style = "ERROR"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● Stopped"
                        badge_style = "STOPPED"
                        health_detail = "Offline"
                else:
                    if port_open:
                        badge_text = "● Running"
                        badge_style = "RUNNING"
                        health_detail = f"Serving http://localhost:{port}"
                        with self._state_lock:
                            self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● Starting"
                        badge_style = "STARTING"
                        health_detail = "Starting Vite..."
                    elif current_state == "ERROR":
                        badge_text = "● Problem"
                        badge_style = "ERROR"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● Stopped"
                        badge_style = "STOPPED"
                        health_detail = "Offline"

                if meta_override:
                    meta_text = meta_override
                elif badge_style == "WARN":
                    meta_text = (
                        "Waiting for the database to start" if "Waiting" in badge_text
                        else "Running, but it needs a check. Try Restart."
                    )
                else:
                    meta_text = {
                        "RUNNING": "Working normally",
                        "STARTING": "Starting up…",
                        "ERROR": "Stopped because of a problem. Try Restart.",
                    }.get(badge_style, "Not running")
                updates[sid] = (badge_text, badge_style, meta_text, pid_str)

            if not self.is_closing:
                self.root.after(0, lambda: self._apply_card_updates(updates, ram_info, cpu_info, port_status))

        threading.Thread(target=_check_all, daemon=True).start()
        if not self.is_closing:
            self.root.after(1500, self._poll_service_health)

    def _apply_card_updates(
        self,
        updates: dict[str, tuple[str, str, str, str]],
        ram_info: dict,
        cpu_info: dict,
        port_status: dict[int, bool],
    ) -> None:
        # Update Service Cards
        for sid, (badge_text, badge_style, meta_text, _) in updates.items():
            widgets = self.card_widgets.get(sid)
            if not widgets:
                continue

            if badge_style == "RUNNING":
                widgets["badge"].configure(
                    text=badge_text,
                    bg=COLOR_SUCCESS_BG,
                    fg=COLOR_SUCCESS_TEXT,
                    highlightbackground=COLOR_SUCCESS_BORDER,
                )
            elif badge_style in ("STARTING", "WARN"):
                widgets["badge"].configure(
                    text=badge_text,
                    bg=COLOR_WARN_BG,
                    fg=COLOR_WARN_TEXT,
                    highlightbackground=COLOR_WARN_BORDER,
                )
            elif badge_style == "ERROR":
                widgets["badge"].configure(
                    text=badge_text,
                    bg=COLOR_DANGER_BG,
                    fg=COLOR_DANGER_TEXT,
                    highlightbackground=COLOR_DANGER_BORDER,
                )
            else:  # STOPPED
                widgets["badge"].configure(
                    text=badge_text,
                    bg=COLOR_NEUTRAL_BG,
                    fg=COLOR_NEUTRAL_TEXT,
                    highlightbackground=COLOR_NEUTRAL_BORDER,
                )

            widgets["meta"].configure(text=meta_text)

        # Update Hardware Telemetry (RAM & CPU meters and text)
        if hasattr(self, "ram_val_lbl"):
            self.ram_pct_val = ram_info.get("pct", 0.0)
            used_g = ram_info.get("used_gb", 0.0)
            tot_g = ram_info.get("total_gb", 0.0)
            free_g = ram_info.get("free_gb", 0.0)
            self.ram_val_lbl.configure(text=f"{self.ram_pct_val:.0f}% in use")
            if self.ram_pct_val < 70:
                advice = "Plenty of room."
            elif self.ram_pct_val < 85:
                advice = "Getting full, but fine for now."
            else:
                advice = "Very full. Close other programs, or the shop system may run slowly."
            self.ram_sub_lbl.configure(text=f"{used_g} of {tot_g} GB used. {advice}")
            self._redraw_ram_meter()

        if hasattr(self, "cpu_val_lbl"):
            self.cpu_pct_val = cpu_info.get("pct", 0.0)
            cores_cnt = cpu_info.get("cores", 4)
            self.cpu_val_lbl.configure(text=f"{self.cpu_pct_val:.0f}% busy")
            busy_word = "Running smoothly." if self.cpu_pct_val < 75 else "The computer is busy right now."
            self.cpu_sub_lbl.configure(text=busy_word)
            self._redraw_cpu_meter()

        # Update Ports indicators and active count
        active_ports = sum(1 for p, is_on in port_status.items() if is_on)
        if hasattr(self, "services_online_lbl") and self.services_online_lbl:
            self.services_online_lbl.configure(
                text=f"{active_ports} of 4 Running",
                fg=COLOR_SUCCESS_TEXT if active_ports > 0 else COLOR_TEXT_MUTED,
            )
        for p, is_on in port_status.items():
            dot = self.port_dot_widgets.get(p)
            if dot:
                dot.configure(fg=COLOR_SUCCESS_TEXT if is_on else "#9CA3AF")

        # Update Home page status
        self._update_main_status(active_ports, {sid: v[1] for sid, v in updates.items()})

        # Update Sidebar Port Dots and Count
        if hasattr(self, "sidebar_services_count_lbl") and self.sidebar_services_count_lbl:
            self.sidebar_services_count_lbl.configure(
                text=f"{active_ports} of 4 ready",
                fg=COLOR_SUCCESS_TEXT if active_ports > 0 else COLOR_TEXT_MUTED,
            )
        for p, is_on in port_status.items():
            s_dot = self.sidebar_port_dots.get(p)
            if s_dot:
                s_dot.configure(fg=COLOR_SUCCESS_TEXT if is_on else "#665245")

        # Auto-reload accounts when MySQL (:3306) comes online
        if port_status.get(3306) and not getattr(self, "_mysql_was_online", False):
            self._mysql_was_online = True
            self.load_main_accounts()
        elif not port_status.get(3306):
            self._mysql_was_online = False

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
        if self.is_closing:
            return
        with self._state_lock:
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
        try:
            self.root.title("Amaya Control Panel — Stopping services...")
        except Exception:
            pass

        def _shutdown_worker() -> None:
            for sid in ("portal", "customer", "api", "mysql"):
                with self._state_lock:
                    proc = self.processes.get(sid)
                if proc is not None or sid != "mysql":
                    self._stop_service_worker(sid)
            try:
                self.root.after(0, self.root.destroy)
            except Exception:
                pass

        threading.Thread(target=_shutdown_worker, daemon=True).start()


def main() -> None:
    root = tk.Tk()
    AmayaControlPanel(root)
    root.mainloop()


if __name__ == "__main__":
    main()
