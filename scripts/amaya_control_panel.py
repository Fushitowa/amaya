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
        self.root.title("Amaya Atelier — POS, Web & MySQL Service Control Panel")
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
            text="AMAYA ATELIER",
            font=("Georgia", 11, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        tk.Label(
            brand_titles,
            text="Service Dispatcher",
            font=("Segoe UI", 8),
            fg=COLOR_ACCENT_LEATHER,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        # Hairline Divider
        tk.Frame(self.sidebar, height=1, bg=COLOR_HAIRLINE).pack(fill=tk.X, padx=12, pady=(4, 14))

        # Navigation Label
        tk.Label(
            self.sidebar,
            text="NAVIGATION SETTINGS",
            font=("Segoe UI", 7, "bold"),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_PANEL_WARM,
            padx=14,
        ).pack(anchor="w", pady=(0, 6))

        # Nav Buttons
        nav_container = tk.Frame(self.sidebar, bg=COLOR_PANEL_WARM, padx=10)
        nav_container.pack(fill=tk.X)

        self.nav_btn_main = self._make_nav_button(
            nav_container,
            icon="🏠",
            title="Main Control Panel",
            sub="Quick Launch & Accounts",
            target_page="main",
        )
        self.nav_btn_main.pack(fill=tk.X, pady=(0, 8))

        self.nav_btn_adv = self._make_nav_button(
            nav_container,
            icon="⚡",
            title="Advanced Panel",
            sub="Telemetry, 4 Boxes & DB",
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
            text="PORT GUARDIAN",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT)

        self.sidebar_services_count_lbl = tk.Label(
            bot_hdr,
            text="0/4 On",
            font=("Consolas", 8, "bold"),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        )
        self.sidebar_services_count_lbl.pack(side=tk.RIGHT)

        # Micro Port Grid
        p_row = tk.Frame(bot_frame, bg=COLOR_RECESSED)
        p_row.pack(fill=tk.X, pady=(0, 6))
        for p in (3306, 3001, 5173, 5174):
            chip = tk.Frame(p_row, bg=COLOR_PANEL_WARM, padx=3, pady=2, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
            chip.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=1)
            tk.Label(chip, text=f":{p}", font=("Consolas", 7), fg=COLOR_TEXT_MUTED, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT)
            dot = tk.Label(chip, text="●", font=("Segoe UI", 6), fg="#665245", bg=COLOR_PANEL_WARM)
            dot.pack(side=tk.RIGHT)
            self.sidebar_port_dots[p] = dot

        tk.Label(
            bot_frame,
            text="Amaya Atelier v2.5",
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
        # Header Bar
        header = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=16,
            pady=10,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        header.pack(fill=tk.X, pady=(0, 10))

        title_frame = tk.Frame(header, bg=COLOR_PANEL_WARM)
        title_frame.pack(side=tk.LEFT, fill=tk.Y)

        kicker_frame = tk.Frame(title_frame, bg=COLOR_PANEL_WARM)
        kicker_frame.pack(anchor="w")

        tk.Label(kicker_frame, text="●", font=("Segoe UI", 7), fg=COLOR_BRASS, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
        tk.Label(
            kicker_frame,
            text="AMAYA ATELIER • DAILY OPERATIONS & PRIMARY DISPATCH",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_ACCENT_LEATHER,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)

        tk.Label(
            title_frame,
            text="Main Control Panel",
            font=("Georgia", 15, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w", pady=(1, 0))

        tk.Label(
            title_frame,
            text="Start system services and manage authenticated staff & cashier accounts on duty.",
            font=("Segoe UI", 8),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        # 1. SERVICE OPERATIONS & QUICK DISPATCH CARD (Sticky Note)
        dispatch_card = tk.Frame(
            parent,
            bg=COLOR_CARD_DARK,
            padx=16,
            pady=12,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        dispatch_card.pack(fill=tk.X, pady=(0, 10))

        # Washi tape header
        tk.Frame(dispatch_card, height=4, bg=COLOR_SUCCESS_BTN).pack(fill=tk.X, pady=(0, 8))

        top_row = tk.Frame(dispatch_card, bg=COLOR_CARD_DARK)
        top_row.pack(fill=tk.X, pady=(0, 8))

        # Pinned pill
        tag_f = tk.Frame(top_row, bg="#062E17", padx=8, pady=2, highlightthickness=1, highlightbackground=COLOR_SUCCESS_BORDER)
        tag_f.pack(side=tk.LEFT)
        tk.Label(tag_f, text="●", font=("Segoe UI", 7), fg=COLOR_BRASS, bg="#062E17").pack(side=tk.LEFT, padx=(0, 4))
        tk.Label(tag_f, text="01  SERVICE OPERATIONS HUB", font=("Segoe UI", 8, "bold"), fg="#BBF7D0", bg="#062E17").pack(side=tk.LEFT)

        # Status Banner
        self.main_system_status_banner = tk.Label(
            dispatch_card,
            text="● ALL SERVICES OFFLINE (Click 'Start All Services' below to launch)",
            font=("Segoe UI", 9, "bold"),
            fg=COLOR_DANGER_TEXT,
            bg=COLOR_DANGER_BG,
            padx=12,
            pady=8,
            highlightthickness=1,
            highlightbackground=COLOR_DANGER_BORDER,
        )
        self.main_system_status_banner.pack(fill=tk.X, pady=(0, 10))

        # Action Buttons Row (Prominent, fixed dimensions)
        actions_row = tk.Frame(dispatch_card, bg=COLOR_CARD_DARK)
        actions_row.pack(fill=tk.X, pady=(0, 10))

        self._make_button(
            actions_row,
            text="▶ Start All Services",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=self.start_all_services,
            padx=14,
            pady=7,
        ).pack(side=tk.LEFT, padx=(0, 6))

        self._make_button(
            actions_row,
            text="⏹ Stop All Services",
            bg=COLOR_DANGER_BTN,
            fg="#FFFFFF",
            command=self.stop_all_services,
            padx=14,
            pady=7,
        ).pack(side=tk.LEFT, padx=6)

        self._make_button(
            actions_row,
            text="🔄 Restart All",
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_SECONDARY,
            command=self.restart_all_services,
            padx=12,
            pady=7,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=6)

        # Quick Portal Launch Row
        portals_row = tk.Frame(dispatch_card, bg=COLOR_CARD_DARK)
        portals_row.pack(fill=tk.X)

        tk.Label(
            portals_row,
            text="Quick Launch:",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_CARD_DARK,
        ).pack(side=tk.LEFT, padx=(0, 8))

        self._make_button(
            portals_row,
            text="🌐 Customer Menu (:5173)",
            bg="#261D13",
            fg="#FDE68A",
            command=lambda: webbrowser.open("http://localhost:5173"),
            padx=10,
            pady=4,
            border_color="#D97706",
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            portals_row,
            text="🖥️ Staff POS & Admin (:5174)",
            bg="#141D2B",
            fg="#BFDBFE",
            command=lambda: webbrowser.open("http://localhost:5174/login"),
            padx=10,
            pady=4,
            border_color="#2563EB",
        ).pack(side=tk.LEFT, padx=3)

        self._make_button(
            portals_row,
            text="💾 phpMyAdmin (:3306)",
            bg="#281911",
            fg="#FED7AA",
            command=lambda: webbrowser.open("http://localhost/phpmyadmin"),
            padx=10,
            pady=4,
            border_color="#C2410C",
        ).pack(side=tk.LEFT, padx=3)

        # 2. AVAILABLE ACCOUNTS & TEAM CREDENTIALS SECTION
        accounts_outer = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=16,
            pady=12,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        accounts_outer.pack(fill=tk.BOTH, expand=True)

        acc_header = tk.Frame(accounts_outer, bg=COLOR_PANEL_WARM)
        acc_header.pack(fill=tk.X, pady=(0, 8))

        acc_hdr_left = tk.Frame(acc_header, bg=COLOR_PANEL_WARM)
        acc_hdr_left.pack(side=tk.LEFT)

        tk.Label(acc_hdr_left, text="●", font=("Segoe UI", 7), fg=COLOR_BRASS, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 5))
        tk.Label(
            acc_hdr_left,
            text="AVAILABLE ACCOUNTS & TEAM CREDENTIALS (ADMIN & CASHIERS)",
            font=("Segoe UI", 9, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)

        self._make_button(
            acc_header,
            text="🔄 Refresh Accounts",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.load_main_accounts,
            padx=10,
            pady=3,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT)

        # 2-Column Responsive Shelf (Owner Card & Cashiers Card)
        shelf = tk.Frame(accounts_outer, bg=COLOR_PANEL_WARM)
        shelf.pack(fill=tk.BOTH, expand=True)
        shelf.columnconfigure(0, weight=1, uniform="accounts_cols")
        shelf.columnconfigure(1, weight=1, uniform="accounts_cols")

        # --- Card A: Admin / Owner ---
        owner_card = tk.Frame(
            shelf,
            bg="#261D13",
            padx=14,
            pady=10,
            highlightthickness=1,
            highlightbackground="#D97706",
        )
        owner_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=4)

        tk.Frame(owner_card, height=4, bg="#D97706").pack(fill=tk.X, pady=(0, 8))

        owner_top = tk.Frame(owner_card, bg="#261D13")
        owner_top.pack(fill=tk.X, pady=(0, 6))

        owner_pill = tk.Frame(owner_top, bg="#3D270A", padx=7, pady=2, highlightthickness=1, highlightbackground="#D97706")
        owner_pill.pack(side=tk.LEFT)
        tk.Label(owner_pill, text="👑  #OWNER", font=("Segoe UI", 8, "bold"), fg="#FDE68A", bg="#3D270A").pack(side=tk.LEFT)

        self.admin_status_badge = tk.Label(
            owner_top,
            text="● ACTIVE",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_SUCCESS_TEXT,
            bg=COLOR_SUCCESS_BG,
            padx=8,
            pady=2,
            highlightthickness=1,
            highlightbackground=COLOR_SUCCESS_BORDER,
        )
        self.admin_status_badge.pack(side=tk.RIGHT)

        tk.Label(
            owner_card,
            text="Store Owner & Administrator",
            font=("Georgia", 12, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg="#261D13",
        ).pack(anchor="w", pady=(2, 6))

        # Shelf info
        owner_info = tk.Frame(owner_card, bg=COLOR_RECESSED, padx=10, pady=8, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
        owner_info.pack(fill=tk.X, pady=(0, 10))

        tk.Label(owner_info, text="Username: admin (Fixed)", font=("Consolas", 9, "bold"), fg=COLOR_BRASS_LIGHT, bg=COLOR_RECESSED).pack(anchor="w")
        tk.Label(owner_info, text="Role: Full Store & Financial Authority", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_RECESSED).pack(anchor="w", pady=(2, 0))
        tk.Label(owner_info, text="Access: Catalog Vault, Price Matrix, Audit Logs, Users", font=("Segoe UI", 8), fg=COLOR_TEXT_MUTED, bg=COLOR_RECESSED).pack(anchor="w", pady=(1, 0))

        owner_btn_row = tk.Frame(owner_card, bg="#261D13")
        owner_btn_row.pack(fill=tk.X, pady=(4, 0))

        self._make_button(
            owner_btn_row,
            text="🔑 Change Owner Password",
            bg="#38251C",
            fg="#FFFFFF",
            command=self.prompt_change_admin_password,
            padx=10,
            pady=4,
            border_color="#D97706",
        ).pack(side=tk.LEFT)

        # --- Card B: Counter Cashiers ---
        cashier_card = tk.Frame(
            shelf,
            bg="#141D2B",
            padx=14,
            pady=10,
            highlightthickness=1,
            highlightbackground="#2563EB",
        )
        cashier_card.grid(row=0, column=1, sticky="nsew", padx=(6, 0), pady=4)

        tk.Frame(cashier_card, height=4, bg="#2563EB").pack(fill=tk.X, pady=(0, 8))

        c_top = tk.Frame(cashier_card, bg="#141D2B")
        c_top.pack(fill=tk.X, pady=(0, 6))

        c_pill = tk.Frame(c_top, bg="#0E182A", padx=7, pady=2, highlightthickness=1, highlightbackground="#2563EB")
        c_pill.pack(side=tk.LEFT)
        tk.Label(c_pill, text="👥  #CASHIERS", font=("Segoe UI", 8, "bold"), fg="#BFDBFE", bg="#0E182A").pack(side=tk.LEFT)

        self.cashier_status_label = tk.Label(
            c_top,
            text="Checking DB...",
            font=("Consolas", 8),
            fg=COLOR_TEXT_MUTED,
            bg="#141D2B",
        )
        self.cashier_status_label.pack(side=tk.RIGHT)

        tk.Label(
            cashier_card,
            text="Counter Cashiers (Staff Accounts)",
            font=("Georgia", 12, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg="#141D2B",
        ).pack(anchor="w", pady=(2, 2))

        tk.Label(
            cashier_card,
            text="Login: 'staff'  |  Entering their specific password opens their register shift.",
            font=("Segoe UI", 8),
            fg=COLOR_TEXT_WALNUT,
            bg="#141D2B",
        ).pack(anchor="w", pady=(0, 6))

        # Cashier List Container (Scrollable)
        list_outer = tk.Frame(cashier_card, bg=COLOR_RECESSED, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
        list_outer.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

        self.cashier_canvas = tk.Canvas(list_outer, bg=COLOR_RECESSED, highlightthickness=0, height=120)
        c_scroll = tk.Scrollbar(list_outer, orient=tk.VERTICAL, command=self.cashier_canvas.yview)
        self.cashier_canvas.configure(yscrollcommand=c_scroll.set)
        c_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.cashier_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.cashier_rows_container = tk.Frame(self.cashier_canvas, bg=COLOR_RECESSED)
        c_win = self.cashier_canvas.create_window((0, 0), window=self.cashier_rows_container, anchor="nw")

        def _on_c_config(e):
            self.cashier_canvas.itemconfig(c_win, width=e.width)
        self.cashier_canvas.bind("<Configure>", _on_c_config)
        self.cashier_rows_container.bind("<Configure>", lambda e: self.cashier_canvas.configure(scrollregion=self.cashier_canvas.bbox("all")))

        # Cashier Action Buttons
        c_btn_row = tk.Frame(cashier_card, bg="#141D2B")
        c_btn_row.pack(fill=tk.X)

        self._make_button(
            c_btn_row,
            text="+ Add New Cashier",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=self.prompt_add_cashier,
            padx=10,
            pady=4,
        ).pack(side=tk.LEFT, padx=(0, 6))

        self._make_button(
            c_btn_row,
            text="⚙️ Manage Passwords & Status",
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_SECONDARY,
            command=self.open_accounts_manager_dialog,
            padx=10,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT)

    def load_main_accounts(self) -> None:
        if hasattr(self, "cashier_status_label") and self.cashier_status_label:
            self.cashier_status_label.configure(text="Querying database...", fg=COLOR_WARN_TEXT)

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

        if error or not accounts:
            if hasattr(self, "cashier_status_label") and self.cashier_status_label:
                self.cashier_status_label.configure(text="MySQL Offline (Defaults Loaded)", fg=COLOR_TEXT_MUTED)

            notice_frame = tk.Frame(self.cashier_rows_container, bg=COLOR_RECESSED, pady=6)
            notice_frame.pack(fill=tk.X, padx=4)

            tk.Label(
                notice_frame,
                text="⚠️ Database is offline. Start MySQL (:3306) to sync live staff list.",
                font=("Segoe UI", 8, "italic"),
                fg=COLOR_WARN_TEXT,
                bg=COLOR_RECESSED,
            ).pack(anchor="w", pady=(0, 4))

            # Default offline preview cards
            for default_name in ("Cashier 1 (Terminal #1)", "Cashier 2 (Terminal #2)"):
                row = tk.Frame(self.cashier_rows_container, bg=COLOR_PANEL_WARM, padx=8, pady=6, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
                row.pack(fill=tk.X, padx=4, pady=2)
                left = tk.Frame(row, bg=COLOR_PANEL_WARM)
                left.pack(side=tk.LEFT)
                tk.Label(left, text=f"👤 {default_name}", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM).pack(anchor="w")
                tk.Label(left, text="login: staff  |  Standard POS Access", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(anchor="w")
                tk.Label(row, text="● READY", font=("Segoe UI", 7, "bold"), fg=COLOR_WARN_TEXT, bg=COLOR_WARN_BG, padx=6, pady=1).pack(side=tk.RIGHT)
            return

        if hasattr(self, "cashier_status_label") and self.cashier_status_label:
            staff_count = sum(1 for a in accounts if a.get("role") == "staff")
            self.cashier_status_label.configure(text=f"{staff_count} Cashiers Active (Live MySQL)", fg=COLOR_SUCCESS_TEXT)

        # Admin account status
        admin_acc = next((a for a in accounts if a.get("role") == "admin"), None)
        if admin_acc and hasattr(self, "admin_status_badge") and self.admin_status_badge:
            self.admin_status_badge.configure(
                text="● VERIFIED ACTIVE",
                bg=COLOR_SUCCESS_BG,
                fg=COLOR_SUCCESS_TEXT,
            )

        # Render cashiers
        staff_list = [a for a in accounts if a.get("role") == "staff"]
        if not staff_list:
            tk.Label(
                self.cashier_rows_container,
                text="No cashiers configured yet. Click '+ Add New Cashier' below.",
                font=("Segoe UI", 8),
                fg=COLOR_TEXT_MUTED,
                bg=COLOR_RECESSED,
            ).pack(pady=8)
            return

        for idx, staff in enumerate(staff_list):
            row_bg = COLOR_PANEL_WARM if idx % 2 == 0 else COLOR_CARD_DARK
            row = tk.Frame(self.cashier_rows_container, bg=row_bg, padx=8, pady=6, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
            row.pack(fill=tk.X, padx=4, pady=2)

            left = tk.Frame(row, bg=row_bg)
            left.pack(side=tk.LEFT)
            dname = staff.get("displayName") or f"Cashier {staff.get('id')}"
            tk.Label(left, text=f"👤 {dname}", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=row_bg).pack(anchor="w")

            is_act = staff.get("isActive", True)
            status_text = "● Active" if is_act else "● Inactive"
            status_col = COLOR_SUCCESS_TEXT if is_act else COLOR_DANGER_TEXT
            tk.Label(left, text=f"login: staff  |  ID #{staff.get('id')}", font=("Consolas", 8), fg=COLOR_TEXT_WALNUT, bg=row_bg).pack(anchor="w")

            badge = tk.Label(row, text=status_text, font=("Segoe UI", 7, "bold"), fg=status_col, bg=COLOR_RECESSED, padx=6, pady=2, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
            badge.pack(side=tk.RIGHT)

    def prompt_change_admin_password(self) -> None:
        dlg = tk.Toplevel(self.root)
        dlg.title("Change Owner Password")
        dlg.geometry("420x240")
        dlg.minsize(380, 220)
        dlg.configure(bg=COLOR_CANVAS_BG)
        dlg.transient(self.root)
        dlg.grab_set()

        hdr = tk.Frame(dlg, bg=COLOR_PANEL_WARM, padx=14, pady=10, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        hdr.pack(fill=tk.X)
        tk.Label(hdr, text="🔑 CHANGE STORE OWNER PASSWORD", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=COLOR_PANEL_WARM).pack(anchor="w")
        tk.Label(hdr, text="Account: admin (Username cannot be changed)", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(anchor="w")

        body = tk.Frame(dlg, bg=COLOR_CANVAS_BG, padx=16, pady=12)
        body.pack(fill=tk.BOTH, expand=True)

        tk.Label(body, text="New Password (min 8 chars):", font=("Segoe UI", 8, "bold"), fg=COLOR_TEXT_SECONDARY, bg=COLOR_CANVAS_BG).pack(anchor="w", pady=(0, 4))
        pwd_entry = tk.Entry(body, show="*", width=28, bg=COLOR_RECESSED, fg=COLOR_TEXT_PRIMARY, insertbackground=COLOR_TEXT_PRIMARY, relief=tk.FLAT, font=("Consolas", 10), highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        pwd_entry.pack(fill=tk.X, pady=(0, 8))
        pwd_entry.focus_set()

        msg_lbl = tk.Label(body, text="", font=("Segoe UI", 8), fg=COLOR_DANGER_TEXT, bg=COLOR_CANVAS_BG)
        msg_lbl.pack(anchor="w", pady=(0, 8))

        def _save():
            new_p = pwd_entry.get().strip()
            if len(new_p) < 8:
                msg_lbl.configure(text="Password must be at least 8 characters.", fg=COLOR_DANGER_TEXT)
                return
            msg_lbl.configure(text="Updating password in database...", fg=COLOR_WARN_TEXT)
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
                        dlg.after(0, lambda: [
                            messagebox.showinfo("Success", "Owner (admin) password updated successfully!"),
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
        self._make_button(btn_row, text="Save Password", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF", command=_save, padx=12, pady=4).pack(side=tk.LEFT)
        self._make_button(btn_row, text="Cancel", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=dlg.destroy, padx=10, pady=4).pack(side=tk.RIGHT)

    def prompt_add_cashier(self) -> None:
        dlg = tk.Toplevel(self.root)
        dlg.title("Add New Cashier")
        dlg.geometry("420x290")
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
                        [node_exe, "src/account-manager.js", "add-cashier", nm, pw],
                        cwd=str(API_DIR),
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
        self._make_button(btn_row, text="+ Add Cashier", bg=COLOR_SUCCESS_BTN, fg="#FFFFFF", command=_add, padx=12, pady=4).pack(side=tk.LEFT)
        self._make_button(btn_row, text="Cancel", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=dlg.destroy, padx=10, pady=4).pack(side=tk.RIGHT)

    # ------------------------------------------------------------------
    # ADVANCED PANEL — TELEMETRY, 4 BOXES, MIGRATION, VAULT & LOGS
    # ------------------------------------------------------------------
    def _build_advanced_panel(self, parent: tk.Widget) -> None:
        # 1. Advanced Header Bar
        header = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=16,
            pady=8,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        header.pack(fill=tk.X, pady=(0, 4))

        title_frame = tk.Frame(header, bg=COLOR_PANEL_WARM)
        title_frame.pack(side=tk.LEFT, fill=tk.Y)

        kicker_frame = tk.Frame(title_frame, bg=COLOR_PANEL_WARM)
        kicker_frame.pack(anchor="w")

        tk.Label(kicker_frame, text="●", font=("Segoe UI", 7), fg=COLOR_BRASS, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
        tk.Label(
            kicker_frame,
            text="AMAYA ATELIER • ADVANCED SYSTEM ORCHESTRATION & TELEMETRY",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_ACCENT_LEATHER,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)

        tk.Label(
            title_frame,
            text="Advanced Control Panel & Diagnostics",
            font=("Georgia", 13, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w", pady=(1, 0))

        btn_bar = tk.Frame(header, bg=COLOR_PANEL_WARM)
        btn_bar.pack(side=tk.RIGHT)

        self._make_button(
            btn_bar,
            text="▶ Start All",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=self.start_all_services,
            padx=9,
            pady=4,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="⏹ Stop All",
            bg=COLOR_DANGER_BTN,
            fg="#FFFFFF",
            command=self.stop_all_services,
            padx=9,
            pady=4,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="🔄 Restart",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.restart_all_services,
            padx=8,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="🧹 Free Ports",
            bg=COLOR_CARD_DARK,
            fg=COLOR_WARN_TEXT,
            command=self.free_all_ports,
            padx=8,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="🛠️ Setup / Migrate",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.run_setup_and_migrate,
            padx=8,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            btn_bar,
            text="👥 Accounts Dialog",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.open_accounts_manager_dialog,
            padx=8,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=2)

        # 2. Hardware Telemetry Panel (RAM & CPU scaling)
        self._build_telemetry_panel(parent)

        # 3. Service Cards Grid (2x2 layout, stretches proportionally with uniform columns)
        cards_frame = tk.Frame(parent, bg=COLOR_CANVAS_BG)
        cards_frame.pack(fill=tk.X, pady=3)
        for col in range(2):
            cards_frame.columnconfigure(col, weight=1, uniform="service_cards")

        for idx, cfg in enumerate(SERVICES_CONFIG):
            row_idx = idx // 2
            col_idx = idx % 2
            self._build_service_card(cards_frame, cfg, row_idx, col_idx)

        # 4. Inventory & Menu Catalog Vault Ribbon (Archive & Clean / Recover)
        vault_bar = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=12,
            pady=6,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        vault_bar.pack(fill=tk.X, pady=3)

        vault_left = tk.Frame(vault_bar, bg=COLOR_PANEL_WARM)
        vault_left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        tk.Label(
            vault_left,
            text="🗄️ INVENTORY & MENU CATALOG VAULT (ONE-CLICK ARCHIVE & CLEAN / RECOVER)",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_ACCENT_LEATHER,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")

        self.vault_status_lbl = tk.Label(
            vault_left,
            text="Checking live catalog & archived vault snapshot...",
            font=("Consolas", 8),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        )
        self.vault_status_lbl.pack(anchor="w", pady=(1, 0))

        vault_btns = tk.Frame(vault_bar, bg=COLOR_PANEL_WARM)
        vault_btns.pack(side=tk.RIGHT)

        self._make_button(
            vault_btns,
            text="🗄️ Archive & Clean",
            bg="#9A3412",
            fg="#FFFFFF",
            command=self.archive_and_clean_catalog,
            padx=9,
            pady=3,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            vault_btns,
            text="♻️ Recover Catalog",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=self.recover_archived_catalog,
            padx=9,
            pady=3,
        ).pack(side=tk.LEFT, padx=2)

        self._make_button(
            vault_btns,
            text="📂 Backups",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.open_vault_backups_folder,
            padx=8,
            pady=3,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.LEFT, padx=(2, 0))

        # 5. Live Diagnostics & Notebook Terminal
        self._build_console_panel(parent)

    # ------------------------------------------------------------------
    # HARDWARE TELEMETRY PANEL (RAM, CPU & PORTS - AUTO-SCALING)
    # ------------------------------------------------------------------
    def _build_telemetry_panel(self, parent: tk.Widget) -> None:
        panel = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=14,
            pady=6,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        panel.pack(fill=tk.X, pady=3)

        # Panel Title Bar with brass rivet
        top_bar = tk.Frame(panel, bg=COLOR_PANEL_WARM)
        top_bar.pack(fill=tk.X, pady=(0, 4))

        title_left = tk.Frame(top_bar, bg=COLOR_PANEL_WARM)
        title_left.pack(side=tk.LEFT)

        tk.Label(
            title_left,
            text="●",
            font=("Segoe UI", 7),
            fg=COLOR_BRASS,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT, padx=(0, 5))

        tk.Label(
            title_left,
            text="SYSTEM HARDWARE VITALS & RESOURCE TELEMETRY",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)

        badge = tk.Label(
            title_left,
            text="● LIVE MONITORED (1.5s POLLING)",
            font=("Segoe UI", 7, "bold"),
            fg=COLOR_SUCCESS_TEXT,
            bg=COLOR_SUCCESS_BG,
            padx=6,
            pady=1,
            highlightthickness=1,
            highlightbackground=COLOR_SUCCESS_BORDER,
        )
        badge.pack(side=tk.LEFT, padx=8)

        tk.Label(
            top_bar,
            text="Dual-Stack IPv4 + IPv6 Guard Active • Zero-Collision Ports",
            font=("Consolas", 8),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.RIGHT)

        # 3-Column Responsive Meter Shelf
        shelf = tk.Frame(panel, bg=COLOR_PANEL_WARM)
        shelf.pack(fill=tk.X)
        for col in range(3):
            shelf.columnconfigure(col, weight=1, uniform="telemetry_cols")

        # --- Gauge 1: RAM Memory (Horizontally scalable meter bar) ---
        ram_frame = tk.Frame(
            shelf,
            bg=COLOR_RECESSED,
            padx=10,
            pady=5,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        ram_frame.grid(row=0, column=0, sticky="nsew", padx=3)

        ram_top = tk.Frame(ram_frame, bg=COLOR_RECESSED)
        ram_top.pack(fill=tk.X)
        tk.Label(
            ram_top,
            text="🧠 SYSTEM RAM USAGE",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT)
        self.ram_val_lbl = tk.Label(
            ram_top,
            text="-- GB / -- GB (0.0%)",
            font=("Consolas", 8, "bold"),
            fg=COLOR_WARN_TEXT,
            bg=COLOR_RECESSED,
        )
        self.ram_val_lbl.pack(side=tk.RIGHT)

        # Meter Bar Canvas (auto-resizes on window scale!)
        self.ram_canvas = tk.Canvas(
            ram_frame,
            height=12,
            bg=COLOR_RECESSED,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        self.ram_canvas.pack(fill=tk.X, pady=(3, 2))
        self.ram_canvas.bind("<Configure>", self._redraw_ram_meter)

        self.ram_sub_lbl = tk.Label(
            ram_frame,
            text="Free: Checking...  |  Status: Healthy",
            font=("Consolas", 7),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        )
        self.ram_sub_lbl.pack(anchor="w")

        # --- Gauge 2: CPU Processor Load (Horizontally scalable meter bar) ---
        cpu_frame = tk.Frame(
            shelf,
            bg=COLOR_RECESSED,
            padx=10,
            pady=5,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        cpu_frame.grid(row=0, column=1, sticky="nsew", padx=3)

        cpu_top = tk.Frame(cpu_frame, bg=COLOR_RECESSED)
        cpu_top.pack(fill=tk.X)
        tk.Label(
            cpu_top,
            text="⚡ PROCESSOR LOAD (CPU)",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT)
        self.cpu_val_lbl = tk.Label(
            cpu_top,
            text="0.0% (-- Cores)",
            font=("Consolas", 8, "bold"),
            fg=COLOR_SUCCESS_TEXT,
            bg=COLOR_RECESSED,
        )
        self.cpu_val_lbl.pack(side=tk.RIGHT)

        self.cpu_canvas = tk.Canvas(
            cpu_frame,
            height=12,
            bg=COLOR_RECESSED,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        self.cpu_canvas.pack(fill=tk.X, pady=(3, 2))
        self.cpu_canvas.bind("<Configure>", self._redraw_cpu_meter)

        self.cpu_sub_lbl = tk.Label(
            cpu_frame,
            text="Logical Cores Active  |  Thermal: Normal",
            font=("Consolas", 7),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        )
        self.cpu_sub_lbl.pack(anchor="w")

        # --- Gauge 3: Active Services & Port Guard ---
        ports_frame = tk.Frame(
            shelf,
            bg=COLOR_RECESSED,
            padx=10,
            pady=5,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        ports_frame.grid(row=0, column=2, sticky="nsew", padx=3)

        ports_top = tk.Frame(ports_frame, bg=COLOR_RECESSED)
        ports_top.pack(fill=tk.X)
        tk.Label(
            ports_top,
            text="🛡️ AMAYA SERVICE PORTS",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_SECONDARY,
            bg=COLOR_RECESSED,
        ).pack(side=tk.LEFT)
        self.services_online_lbl = tk.Label(
            ports_top,
            text="0 of 4 Running",
            font=("Consolas", 8, "bold"),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        )
        self.services_online_lbl.pack(side=tk.RIGHT)

        # 4 Port Indicators Strip
        dots_row = tk.Frame(ports_frame, bg=COLOR_RECESSED)
        dots_row.pack(fill=tk.X, pady=(3, 2))
        for p in (3306, 3001, 5173, 5174):
            dot_chip = tk.Frame(dots_row, bg="#1C130E", highlightthickness=1, highlightbackground=COLOR_CARD_BORDER, padx=4, pady=1)
            dot_chip.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=1)
            tk.Label(dot_chip, text=f":{p}", font=("Consolas", 7, "bold"), fg=COLOR_TEXT_MUTED, bg="#1C130E").pack(side=tk.LEFT)
            dot_lbl = tk.Label(dot_chip, text="●", font=("Segoe UI", 7), fg="#665245", bg="#1C130E")
            dot_lbl.pack(side=tk.RIGHT, padx=(2, 0))
            self.port_dot_widgets[p] = dot_lbl

        tk.Label(
            ports_frame,
            text="Port Guardian IPv4/IPv6  |  Auto-Stale PID Clean",
            font=("Consolas", 7),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_RECESSED,
        ).pack(anchor="w")

    # ------------------------------------------------------------------
    # LIVE DIAGNOSTICS & NOTEBOOK TERMINAL
    # ------------------------------------------------------------------
    def _build_console_panel(self, parent: tk.Widget) -> None:
        console_outer = tk.Frame(
            parent,
            bg=COLOR_PANEL_WARM,
            padx=12,
            pady=6,
            highlightthickness=1,
            highlightbackground=COLOR_CARD_BORDER,
        )
        console_outer.pack(fill=tk.BOTH, expand=True, pady=(3, 6))

        console_toolbar = tk.Frame(console_outer, bg=COLOR_PANEL_WARM)
        console_toolbar.pack(fill=tk.X, pady=(0, 4))

        tk.Label(
            console_toolbar,
            text="LIVE TERMINAL OUTPUT & DIAGNOSTICS (IPv4 + IPv6 PORT GUARD ACTIVE)",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)

        auto_chk = tk.Checkbutton(
            console_toolbar,
            text="Auto-Scroll",
            variable=self.auto_scroll_var,
            bg=COLOR_PANEL_WARM,
            fg=COLOR_TEXT_SECONDARY,
            selectcolor=COLOR_RECESSED,
            activebackground=COLOR_PANEL_WARM,
            activeforeground=COLOR_TEXT_PRIMARY,
            font=("Segoe UI", 8),
        )
        auto_chk.pack(side=tk.RIGHT, padx=4)

        self._make_button(
            console_toolbar,
            text="Copy Current Log",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.copy_current_log,
            padx=8,
            pady=2,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT, padx=2)

        self._make_button(
            console_toolbar,
            text="Clear Current Log",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=self.clear_current_log,
            padx=8,
            pady=2,
            border_color=COLOR_CARD_BORDER,
        ).pack(side=tk.RIGHT, padx=2)

        style = ttk.Style()
        style.theme_use("default")
        style.configure("Amaya.TNotebook", background=COLOR_PANEL_WARM, borderwidth=0)
        style.configure(
            "Amaya.TNotebook.Tab",
            background="#2C1F18",
            foreground=COLOR_TEXT_WALNUT,
            padding=(12, 4),
            font=("Segoe UI", 8, "bold"),
            borderwidth=1,
        )
        style.map(
            "Amaya.TNotebook.Tab",
            background=[("selected", COLOR_ACCENT_LEATHER)],
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
            tab_frame = tk.Frame(self.notebook, bg=COLOR_TERMINAL_BG)
            self.notebook.add(tab_frame, text=tab_title)

            scrollbar = tk.Scrollbar(tab_frame, orient=tk.VERTICAL)
            text_widget = tk.Text(
                tab_frame,
                bg=COLOR_TERMINAL_BG,
                fg=COLOR_TERMINAL_FG,
                insertbackground="#FFFFFF",
                font=("Consolas", 9),
                wrap=tk.WORD,
                yscrollcommand=scrollbar.set,
                padx=8,
                pady=6,
                borderwidth=0,
                state=tk.DISABLED,
            )
            scrollbar.config(command=text_widget.yview)
            scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            text_widget.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

            text_widget.tag_config("timestamp", foreground=COLOR_TEXT_MUTED)
            text_widget.tag_config("prefix_mysql", foreground="#FBBF24", font=("Consolas", 9, "bold"))
            text_widget.tag_config("prefix_api", foreground="#FB923C", font=("Consolas", 9, "bold"))
            text_widget.tag_config("prefix_customer", foreground="#4ADE80", font=("Consolas", 9, "bold"))
            text_widget.tag_config("prefix_portal", foreground="#93C5FD", font=("Consolas", 9, "bold"))
            text_widget.tag_config("prefix_system", foreground=COLOR_BRASS_LIGHT, font=("Consolas", 9, "bold"))
            text_widget.tag_config("error", foreground="#FCA5A5")
            text_widget.tag_config("success", foreground="#86EFAC")
            text_widget.tag_config("warn", foreground="#FDE047")
            text_widget.tag_config("normal", foreground=COLOR_TERMINAL_FG)

            self.log_widgets[tab_id] = text_widget

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
        canvas.create_rectangle(0, 0, w, h, fill=COLOR_RECESSED, outline=COLOR_CARD_BORDER, width=1)
        fill_w = max(0, min(w, int(w * (pct / 100.0))))
        if fill_w > 0:
            bar_color = "#F59E0B" if pct < 85 else "#EF4444"
            canvas.create_rectangle(1, 1, fill_w, h - 1, fill=bar_color, outline="")

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
        canvas.create_rectangle(0, 0, w, h, fill=COLOR_RECESSED, outline=COLOR_CARD_BORDER, width=1)
        fill_w = max(0, min(w, int(w * (pct / 100.0))))
        if fill_w > 0:
            bar_color = "#22C55E" if pct < 75 else "#F59E0B" if pct < 90 else "#EF4444"
            canvas.create_rectangle(1, 1, fill_w, h - 1, fill=bar_color, outline="")

    # ------------------------------------------------------------------
    # SERVICE CARDS (ARTISANAL STICKY NOTES & NOTEBOOK DESIGN)
    # ------------------------------------------------------------------
    def _build_service_card(self, parent: tk.Frame, cfg: dict, row_index: int, col_index: int) -> None:
        sid = cfg["id"]
        card_bg = cfg.get("card_bg", COLOR_CARD_DARK)
        card = tk.Frame(
            parent,
            bg=card_bg,
            padx=14,
            pady=10,
            highlightthickness=1,
            highlightbackground=cfg.get("accent", COLOR_CARD_BORDER),
        )
        card.grid(row=row_index, column=col_index, sticky="nsew", padx=4, pady=4)

        # Tactile Sticky Note Top Tape Strip
        tape_strip = tk.Frame(card, height=4, bg=cfg.get("tape_color", COLOR_ACCENT_LEATHER))
        tape_strip.pack(fill=tk.X, pady=(0, 6))

        # Sticky Note Header Strip (Pinned Index Tag + Brass Rivet + Status Badge)
        top_row = tk.Frame(card, bg=card_bg)
        top_row.pack(fill=tk.X, pady=(0, 4))

        # Pinned Number Tag Pill (like category tags in Amaya UI)
        tag_frame = tk.Frame(
            top_row,
            bg=cfg.get("pill_bg", COLOR_NEUTRAL_BG),
            padx=7,
            pady=2,
            highlightthickness=1,
            highlightbackground=cfg.get("accent", COLOR_CARD_BORDER),
        )
        tag_frame.pack(side=tk.LEFT)

        tk.Label(
            tag_frame,
            text="●",
            font=("Segoe UI", 7),
            fg=COLOR_BRASS,
            bg=cfg.get("pill_bg", COLOR_NEUTRAL_BG),
        ).pack(side=tk.LEFT, padx=(0, 4))

        tk.Label(
            tag_frame,
            text=f"{cfg.get('pin_no', '#')}  {cfg.get('tag_role', 'SERVICE')}",
            font=("Segoe UI", 8, "bold"),
            fg=cfg.get("pill_fg", COLOR_TEXT_SECONDARY),
            bg=cfg.get("pill_bg", COLOR_NEUTRAL_BG),
        ).pack(side=tk.LEFT)

        status_badge = tk.Label(
            top_row,
            text="● STOPPED",
            font=("Segoe UI", 8, "bold"),
            fg=COLOR_NEUTRAL_TEXT,
            bg=COLOR_NEUTRAL_BG,
            padx=8,
            pady=2,
            highlightthickness=1,
            highlightbackground=COLOR_NEUTRAL_BORDER,
        )
        status_badge.pack(side=tk.RIGHT)

        # Service Title (High contrast, bright on dark sticky note card)
        title_lbl = tk.Label(
            card,
            text=cfg["name"],
            font=("Segoe UI", 11, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=card_bg,
        )
        title_lbl.pack(anchor="w", pady=(2, 4))

        # Recessed Metadata Shelf
        meta_frame = tk.Frame(
            card,
            bg=COLOR_RECESSED,
            padx=8,
            pady=4,
            highlightthickness=1,
            highlightbackground=COLOR_HAIRLINE,
        )
        meta_frame.pack(fill=tk.X, pady=(0, 8))

        meta_lbl = tk.Label(
            meta_frame,
            text=f"Port: :{cfg['port']}  |  PID: —  |  Status: Offline",
            font=("Consolas", 8),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_RECESSED,
        )
        meta_lbl.pack(anchor="w")

        # Action Buttons Row (Fixed size, ergonomic button pads)
        btn_row = tk.Frame(card, bg=card_bg)
        btn_row.pack(fill=tk.X)

        start_btn = self._make_button(
            btn_row,
            text="▶ Start",
            bg=COLOR_SUCCESS_BTN,
            fg="#FFFFFF",
            command=lambda s=sid: self.start_service(s),
            padx=10,
            pady=4,
        )
        start_btn.pack(side=tk.LEFT, padx=(0, 4))

        stop_btn = self._make_button(
            btn_row,
            text="⏹ Stop",
            bg=COLOR_DANGER_BTN,
            fg="#FFFFFF",
            command=lambda s=sid: self.stop_service(s),
            padx=10,
            pady=4,
        )
        stop_btn.pack(side=tk.LEFT, padx=4)

        restart_btn = self._make_button(
            btn_row,
            text="🔄 Restart",
            bg=COLOR_CARD_DARK,
            fg=COLOR_TEXT_SECONDARY,
            command=lambda s=sid: self.restart_service(s),
            padx=10,
            pady=4,
            border_color=COLOR_CARD_BORDER,
        )
        restart_btn.pack(side=tk.LEFT, padx=4)

        open_btn = self._make_button(
            btn_row,
            text=f"🌐 {cfg['open_label']}",
            bg="#382414",
            fg="#FCD34D",
            command=lambda u=cfg["url"]: webbrowser.open(u),
            padx=10,
            pady=4,
            border_color=cfg.get("accent", COLOR_CARD_BORDER),
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
        dialog.title("Amaya Atelier — Team Accounts & Cashier Passwords")
        dialog.geometry("780x640")
        dialog.minsize(700, 520)
        dialog.configure(bg=COLOR_CANVAS_BG)
        dialog.transient(self.root)

        # Header Frame
        hdr = tk.Frame(dialog, bg=COLOR_PANEL_WARM, padx=16, pady=12, highlightthickness=1, highlightbackground=COLOR_CARD_BORDER)
        hdr.pack(fill=tk.X)
        tk.Label(
            hdr,
            text="👥 TEAM ACCOUNTS & CASHIER CREDENTIALS",
            font=("Segoe UI", 11, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w")
        tk.Label(
            hdr,
            text="Owner signs in with 'admin'. Counter staff signs in with 'staff' + their unique cashier password.",
            font=("Segoe UI", 8),
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

        def show_status(msg: str, is_error: bool = False) -> None:
            status_lbl.configure(text=msg, fg=COLOR_DANGER_TEXT if is_error else COLOR_SUCCESS_TEXT)

        # Main Body
        body = tk.Frame(dialog, bg=COLOR_CANVAS_BG, padx=16, pady=4)
        body.pack(fill=tk.BOTH, expand=True)

        # --- Card 1: Admin / Owner ---
        admin_card = tk.LabelFrame(
            body,
            text=" 👑 Administrator / Owner Account ",
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
            text="Username: admin (Fixed)",
            font=("Segoe UI", 9, "bold"),
            fg=COLOR_TEXT_PRIMARY,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT)
        tk.Label(
            admin_info,
            text="Full dashboard, reports & inventory control",
            font=("Segoe UI", 8),
            fg=COLOR_TEXT_MUTED,
            bg=COLOR_PANEL_WARM,
        ).pack(side=tk.LEFT, padx=12)

        admin_input_row = tk.Frame(admin_card, bg=COLOR_PANEL_WARM)
        admin_input_row.pack(fill=tk.X)
        tk.Label(
            admin_input_row,
            text="New Owner Password:",
            font=("Segoe UI", 8),
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
            bg=COLOR_ACCENT_MOCHA,
            fg="#FFFFFF",
            command=save_admin_pwd,
            padx=10,
            pady=3,
        ).pack(side=tk.LEFT)

        # --- Card 2: Cashier Team (Staff Accounts) ---
        cashier_card = tk.LabelFrame(
            body,
            text=" 👥 Counter Cashiers (Staff Accounts) ",
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
            text="Shared Login Username: 'staff' (case-insensitive). Entering their specific password identifies who is on duty.",
            font=("Segoe UI", 8),
            fg=COLOR_TEXT_WALNUT,
            bg=COLOR_PANEL_WARM,
        ).pack(anchor="w", pady=(0, 6))

        # Add Cashier Row
        add_frame = tk.Frame(cashier_card, bg=COLOR_PANEL_WARM, pady=4)
        add_frame.pack(fill=tk.X, pady=(0, 8))
        tk.Label(add_frame, text="Name:", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
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
        new_name_entry.insert(0, "Cashier 3")
        new_name_entry.pack(side=tk.LEFT, padx=(0, 8))

        tk.Label(add_frame, text="Password:", font=("Segoe UI", 8), fg=COLOR_TEXT_WALNUT, bg=COLOR_PANEL_WARM).pack(side=tk.LEFT, padx=(0, 4))
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
                tk.Label(list_frame, text="No cashiers found.", fg=COLOR_TEXT_MUTED, bg=COLOR_RECESSED, font=("Segoe UI", 9)).pack(pady=10)
                return

            for idx, staff in enumerate(staff_list):
                row_bg = COLOR_PANEL_WARM if idx % 2 == 0 else COLOR_CARD_DARK
                row = tk.Frame(list_frame, bg=row_bg, padx=10, pady=8, highlightthickness=1, highlightbackground=COLOR_HAIRLINE)
                row.pack(fill=tk.X, padx=4, pady=2)

                left = tk.Frame(row, bg=row["bg"])
                left.pack(side=tk.LEFT)
                name_lbl = tk.Label(left, text=f"👤 {staff.get('displayName')}", font=("Segoe UI", 9, "bold"), fg=COLOR_TEXT_PRIMARY, bg=row["bg"])
                name_lbl.pack(anchor="w")
                sub_lbl = tk.Label(
                    left,
                    text=f"login: staff  |  Status: {'Active' if staff.get('isActive') else 'Deactivated'}",
                    font=("Segoe UI", 8),
                    fg=COLOR_SUCCESS_TEXT if staff.get("isActive") else COLOR_DANGER_TEXT,
                    bg=row["bg"],
                )
                sub_lbl.pack(anchor="w")

                right = tk.Frame(row, bg=row["bg"])
                right.pack(side=tk.RIGHT)

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

                self._make_button(right, text="Set Password", bg=COLOR_CARD_DARK, fg=COLOR_TEXT_SECONDARY, command=make_update_pwd_cmd(staff.get("id"), staff.get("displayName"), new_pwd_entry), padx=6, pady=2, border_color=COLOR_CARD_BORDER).pack(side=tk.LEFT, padx=(0, 4))

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
                    cpu_info["pct"] = 14.0
                except Exception:
                    pass

            # 2. Service & Port Health Checks
            for cfg in SERVICES_CONFIG:
                sid = cfg["id"]
                port = cfg["port"]
                proc = self.processes.get(sid)
                port_open = mysql_open if sid == "mysql" else is_port_open(port)
                port_status[port] = port_open

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
                        badge_style = "RUNNING"
                        health_detail = "Listening on 127.0.0.1:3306"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_style = "STARTING"
                        health_detail = "Initializing InnoDB..."
                    else:
                        badge_text = "● STOPPED"
                        badge_style = "STOPPED"
                        health_detail = "Offline (Click Start All)"
                elif sid == "api":
                    if port_open:
                        if not mysql_open:
                            badge_text = "● MYSQL OFFLINE"
                            badge_style = "WARN"
                            health_detail = "Waiting for MySQL (:3306)"
                        else:
                            now = time.time()
                            if now - self._last_api_health_time >= 5.0:
                                self._cached_api_health = check_api_health()
                                self._last_api_health_time = now
                            health_state, health_detail = self._cached_api_health
                            if health_state == "ok":
                                badge_text = "● RUNNING"
                                badge_style = "RUNNING"
                            elif health_state == "db_error":
                                badge_text = "● DB WARNING"
                                badge_style = "WARN"
                            else:
                                badge_text = "● RUNNING"
                                badge_style = "RUNNING"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_style = "STARTING"
                        health_detail = "Booting Express..."
                    elif self.service_states.get(sid) == "ERROR":
                        badge_text = "● ERROR"
                        badge_style = "ERROR"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● STOPPED"
                        badge_style = "STOPPED"
                        health_detail = "Offline"
                else:
                    if port_open:
                        badge_text = "● RUNNING"
                        badge_style = "RUNNING"
                        health_detail = f"Serving http://localhost:{port}"
                        self.service_states[sid] = "RUNNING"
                    elif proc is not None and proc.poll() is None:
                        badge_text = "● STARTING..."
                        badge_style = "STARTING"
                        health_detail = "Starting Vite..."
                    elif self.service_states.get(sid) == "ERROR":
                        badge_text = "● ERROR"
                        badge_style = "ERROR"
                        health_detail = "Exited with error"
                    else:
                        badge_text = "● STOPPED"
                        badge_style = "STOPPED"
                        health_detail = "Offline"

                meta_text = f"Port: :{port}  |  PID: {pid_str}  |  Status: {health_detail}"
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
            self.ram_val_lbl.configure(text=f"{used_g} GB / {tot_g} GB ({self.ram_pct_val}%)")
            status_word = "Optimal" if self.ram_pct_val < 85 else "High Load"
            self.ram_sub_lbl.configure(text=f"Free: {free_g} GB  |  Status: {status_word}")
            self._redraw_ram_meter()

        if hasattr(self, "cpu_val_lbl"):
            self.cpu_pct_val = cpu_info.get("pct", 0.0)
            cores_cnt = cpu_info.get("cores", 4)
            self.cpu_val_lbl.configure(text=f"{self.cpu_pct_val}% ({cores_cnt} Cores)")
            load_word = "Normal" if self.cpu_pct_val < 75 else "Elevated"
            self.cpu_sub_lbl.configure(text=f"{cores_cnt} Logical Cores  |  Thermal: {load_word}")
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

        # Update Main View Status Banner
        if hasattr(self, "main_system_status_banner") and self.main_system_status_banner:
            if active_ports == 4:
                self.main_system_status_banner.configure(
                    text="● ALL 4 SERVICES ONLINE & HEALTHY (Port Guard IPv4 + IPv6 Active)",
                    bg=COLOR_SUCCESS_BG,
                    fg=COLOR_SUCCESS_TEXT,
                    highlightbackground=COLOR_SUCCESS_BORDER,
                )
            elif active_ports > 0:
                self.main_system_status_banner.configure(
                    text=f"● PARTIAL SERVICES ACTIVE ({active_ports} of 4 Online) — Waiting for all ports...",
                    bg=COLOR_WARN_BG,
                    fg=COLOR_WARN_TEXT,
                    highlightbackground=COLOR_WARN_BORDER,
                )
            else:
                self.main_system_status_banner.configure(
                    text="● ALL SERVICES OFFLINE (Click 'Start All Services' below to begin)",
                    bg=COLOR_DANGER_BG,
                    fg=COLOR_DANGER_TEXT,
                    highlightbackground=COLOR_DANGER_BORDER,
                )

        # Update Sidebar Port Dots and Count
        if hasattr(self, "sidebar_services_count_lbl") and self.sidebar_services_count_lbl:
            self.sidebar_services_count_lbl.configure(
                text=f"{active_ports}/4 On",
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
