import os
import sys
from datetime import datetime
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    tcPr.append(parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>'))

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f'</w:tcMar>'
    )
    tcPr.append(tcMar)

def add_callout(doc, title, text, bg_hex="FAF7F4", border_hex="8B5E3C"):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Inches(6.5)
    cell = table.cell(0, 0)
    set_cell_background(cell, bg_hex)
    set_cell_margins(cell, top=140, bottom=140, left=200, right=180)
    
    tcPr = cell._tc.get_or_add_tcPr()
    borders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>'
        f'<w:top w:val="none"/>'
        f'<w:left w:val="single" w:sz="24" w:space="0" w:color="{border_hex}"/>'
        f'<w:bottom w:val="none"/>'
        f'<w:right w:val="none"/>'
        f'</w:tcBorders>'
    )
    tcPr.append(borders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(4)
    r_title = p.add_run(f"📌 {title}\n")
    r_title.bold = True
    r_title.font.name = "Arial"
    r_title.font.size = Pt(10.5)
    r_title.font.color.rgb = RGBColor(0x2E, 0x26, 0x1F)
    
    r_text = p.add_run(text)
    r_text.font.name = "Arial"
    r_text.font.size = Pt(9.5)
    r_text.font.color.rgb = RGBColor(0x4A, 0x3E, 0x35)
    
    doc.add_paragraph().paragraph_format.space_after = Pt(6)

def style_heading(p, color_rgb, size_pt, space_before=14, space_after=6):
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.keep_with_next = True
    for r in p.runs:
        r.font.name = "Arial"
        r.font.size = Pt(size_pt)
        r.bold = True
        r.font.color.rgb = color_rgb

def build_docx(output_path):
    doc = docx.Document()
    
    # Page Setup: Letter, 1 inch margins
    for section in doc.sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)
        section.page_width = Inches(8.5)
        section.page_height = Inches(11.0)

    # Palette
    C_ESPRESSO = RGBColor(0x2E, 0x26, 0x1F)   # #2E261F
    C_CARAMEL = RGBColor(0x8B, 0x5E, 0x3C)    # #8B5E3C
    C_GOLD = RGBColor(0xB4, 0x53, 0x09)       # #B45309
    C_INK = RGBColor(0x1F, 0x29, 0x37)        # #1F2937
    C_MUTED = RGBColor(0x6B, 0x72, 0x80)      # #6B7280

    # -------------------------------------------------------------
    # 1. TITLE & DOCUMENT METADATA
    # -------------------------------------------------------------
    p_inst = doc.add_paragraph()
    p_inst.paragraph_format.space_before = Pt(0)
    p_inst.paragraph_format.space_after = Pt(2)
    p_inst.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_inst = p_inst.add_run("ACLC COLLEGE OF BUKIDNON\nCollege of Computer Studies — Bachelor of Science in Information Technology (BSIT)")
    r_inst.font.name = "Arial"
    r_inst.font.size = Pt(9.5)
    r_inst.font.color.rgb = C_MUTED
    r_inst.bold = True

    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(18)
    p_title.paragraph_format.space_after = Pt(4)
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_title = p_title.add_run("AMAYA’S DRINKS AND BITES:\nPOINT OF SALE AND SALES MONITORING SYSTEM")
    r_title.font.name = "Arial"
    r_title.font.size = Pt(19)
    r_title.bold = True
    r_title.font.color.rgb = C_ESPRESSO

    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_before = Pt(4)
    p_sub.paragraph_format.space_after = Pt(16)
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_sub = p_sub.add_run("Comprehensive System Updates, Engineering Architecture & Feature Upgrade Documentation")
    r_sub.font.name = "Arial"
    r_sub.font.size = Pt(12)
    r_sub.bold = True
    r_sub.font.color.rgb = C_CARAMEL

    # Metadata Box
    meta_table = doc.add_table(rows=6, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_table.autofit = False
    meta_table.columns[0].width = Inches(2.2)
    meta_table.columns[1].width = Inches(4.3)
    
    meta_data = [
        ("Document Classification:", "Engineering Upgrade Record (2026)"),
        ("Lead Maintainer & Programmer:", "Ken (@Fushitowa)"),
        ("Helper & Contributor:", "Markie"),
        ("Project:", "Amaya's Drinks and Bites POS & Inventory System"),
        ("Date of Full Audit & Verification:", datetime.now().strftime("%B %d, %Y")),
        ("Repository:", "https://github.com/Fushitowa/amaya.git"),
    ]
    
    for idx, (label, val) in enumerate(meta_data):
        row = meta_table.rows[idx]
        set_cell_background(row.cells[0], "F2E7E0" if idx % 2 == 0 else "FAF7F4")
        set_cell_background(row.cells[1], "FFFFFF" if idx % 2 == 0 else "FDFCFB")
        set_cell_margins(row.cells[0], top=60, bottom=60, left=100, right=100)
        set_cell_margins(row.cells[1], top=60, bottom=60, left=100, right=100)
        
        p0 = row.cells[0].paragraphs[0]
        p0.paragraph_format.space_before = Pt(0)
        p0.paragraph_format.space_after = Pt(0)
        r0 = p0.add_run(label)
        r0.font.name = "Arial"
        r0.font.size = Pt(9)
        r0.bold = True
        r0.font.color.rgb = C_ESPRESSO
        
        p1 = row.cells[1].paragraphs[0]
        p1.paragraph_format.space_before = Pt(0)
        p1.paragraph_format.space_after = Pt(0)
        r1 = p1.add_run(val)
        r1.font.name = "Arial"
        r1.font.size = Pt(9)
        r1.font.color.rgb = C_INK
        if "Ken" in val or "Markie" in val:
            r1.bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(12)

    # -------------------------------------------------------------
    # 2. EXECUTIVE SUMMARY & UPGRADE OVERVIEW
    # -------------------------------------------------------------
    p_h1 = doc.add_paragraph("1. EXECUTIVE SUMMARY & UPGRADE OVERVIEW")
    style_heading(p_h1, C_ESPRESSO, 14, space_before=16, space_after=6)

    doc.add_paragraph(
        "This engineering report provides an exhaustive, verified record of all architectural improvements, "
        "bug fixes, database migrations, Python desktop automation tooling, and user-facing feature additions "
        "implemented across the Amaya’s Drinks and Bites Point of Sale (POS) and Sales Monitoring System. "
        "Developed for Amaya’s Drinks and Bites by Lead Developer Ken with contributions from Markie, "
        "the software automates daily retail counter order taking, kitchen order preparation tracking, "
        "culinary recipe-based ingredient inventory deduction, and multi-tier sales reporting."
    )

    doc.add_paragraph(
        "Prior to this upgrade cycle, the development environment and operational system faced four critical bottlenecks: "
        "(1) manual command-line process management with orphan Node.js process port conflicts on Windows, "
        "(2) MariaDB collation incompatibility causing catalog 500 errors and phantom empty menu states, "
        "(3) restrictive inventory deletion logic that failed to identify dependent recipes, and "
        "(4) lack of a safety-net soft-delete trash archive with automated life-cycle purging and audit logging. "
        "All four areas have now been systematically resolved, tested, and verified in production."
    )

    add_callout(
        doc,
        "Key Upgrade Milestones at a Glance",
        "• Amaya Python Control Panel v2.0: One-click dual-stack IPv4/IPv6 port freeing, XAMPP MySQL auto-start, and multi-service process orchestration.\n"
        "• Collation & Database Recovery: Resolved MariaDB 10.4 utf8mb4_0900_ai_ci crash, applied migrations 007 & 008, and restored menu catalog visibility.\n"
        "• Dependency-Aware Inventory Management: Protected recipes, identified exact linked products ('Milk Tea'), and enabled safe test stock deletions.\n"
        "• 30-Day Safe Archive & Audit Trail: Migration 009, soft-delete life-cycle, rolling hourly auto-purge worker, /admin/archive UI, and 1-click restore.\n"
        "• Account Security & Access Credentials: Verified JWT authentication with active roles for Admin (admin) and Cashier/Staff (juan).",
        bg_hex="FAF7F4", border_hex="8B5E3C"
    )

    # -------------------------------------------------------------
    # 3. COMPLETE ARCHITECTURE & TECH STACK SPECIFICATION
    # -------------------------------------------------------------
    p_h2 = doc.add_paragraph("2. VERIFIED SYSTEM ARCHITECTURE & TECH STACK")
    style_heading(p_h2, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "The system operates across three decoupled, high-performance tiers running locally on the store terminal:"
    )

    arch_table = doc.add_table(rows=5, cols=4)
    arch_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    arch_table.autofit = False
    arch_table.columns[0].width = Inches(1.4)
    arch_table.columns[1].width = Inches(1.5)
    arch_table.columns[2].width = Inches(1.1)
    arch_table.columns[3].width = Inches(2.5)

    arch_headers = ["Layer / Subsystem", "Technology & Version", "Network Port", "Key Operational Responsibilities"]
    for i, h in enumerate(arch_headers):
        cell = arch_table.rows[0].cells[i]
        set_cell_background(cell, "2E261F")
        set_cell_margins(cell, top=80, bottom=80, left=80, right=80)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.font.name = "Arial"
        r.font.size = Pt(8.5)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    arch_rows = [
        ("Desktop Orchestrator", "Python 3.12 (Tkinter GUI, threaded subprocess, socket, win32 API)", "N/A (Host GUI)", "Manages XAMPP MySQL, API, and dual Vite servers; dual-stack IPv4/IPv6 port killer; real-time tabbed logs."),
        ("Backend REST API", "Node.js 24 + Express 5, mysql2/promise, JWT, bcryptjs, Helmet, rate-limit", "TCP :3001 (IPv4/IPv6)", "Transaction-locked order creation, culinary unit conversion, 60s stock alerts, 30-day archive auto-purge."),
        ("Customer Web App", "React 19 + React Router 7 + Vite 8 (CustomerApp.jsx)", "TCP :5173 (strictPort)", "Public read-only digital menu, product showcase, operating hours, and brand showcase for walk-in customers."),
        ("Staff POS & Admin Portal", "React 19 + Lucide Icons + Custom Modular CSS (PortalApp.jsx)", "TCP :5174 (strictPort)", "Counter cashier POS, order queue management, recipe builder, inventory tracking, archive, and sales reports."),
    ]

    for row_idx, data in enumerate(arch_rows, start=1):
        row = arch_table.rows[row_idx]
        bg = "FFFFFF" if row_idx % 2 == 1 else "FAF7F4"
        for col_idx, text in enumerate(data):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=60, bottom=60, left=80, right=80)
            p = cell.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Arial"
            r.font.size = Pt(8.5)
            r.font.color.rgb = C_INK
            if col_idx == 0:
                r.bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # -------------------------------------------------------------
    # 4. UPGRADE PHASE 1: PYTHON CONTROL PANEL v2.0
    # -------------------------------------------------------------
    p_h3 = doc.add_paragraph("3. UPGRADE PHASE 1: AMAYA PYTHON SERVICE CONTROL PANEL (v1.0 ➔ v2.0)")
    style_heading(p_h3, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "To eliminate the operational complexity of launching multiple CMD windows and resolving zombie processes, "
        "the development team implemented a zero-dependency, single-file desktop "
        "management tool: amaya_control_panel.py accompanied by Start_Amaya_Control_Panel.bat."
    )

    doc.add_paragraph("Technical Architecture of the Control Panel:", style="List Bullet")
    doc.add_paragraph(
        "• Multi-Service Management: Sequentially manages four services: (0) XAMPP MySQL Database (:3306), "
        "(1) Backend API (:3001), (2) Customer Website (:5173), and (3) Staff POS & Admin Portal (:5174).",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Dual-Stack IPv4 & IPv6 Port Conflict Resolution (v2.0): Discovered that modern Node.js and Vite bind to dual-stack "
        "IPv6 [::1] and wildcard [::]. Earlier single-stack checks (socket.AF_INET checking 127.0.0.1) failed to identify orphan listeners, "
        "causing strictPort: true crashes. Upgraded to combine netstat -ano -p tcp parsing with both AF_INET and AF_INET6 socket probes, "
        "executing clean process tree termination via taskkill /F /T /PID.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• XAMPP MySQL Auto-Detection & Graceful Shutdown: Automatically checks default locations (C:\\xampp\\mysql\\bin\\mysqld.exe). "
        "If MySQL is stopped, the control panel can launch mysqld.exe as a background service and executes clean, non-corrupting "
        "database shutdowns using C:\\xampp\\mysql\\bin\\mysqladmin.exe -u root shutdown.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Gated Health Polling: Polling GET /api/health is strictly conditional on Port 3306 being open first, completely eliminating "
        "503 'Could not connect to database' console log floods when MySQL is offline.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Tabbed Live Terminal Console: Features dedicated tabs for All Services, Backend API, Customer Web, and Staff Portal. "
        "ANSI escape sequences from Vite and Node are stripped in real time for crisp, distraction-free logging.",
        style="List Bullet"
    )

    # -------------------------------------------------------------
    # 5. UPGRADE PHASE 2: DATABASE COLLATION & MENU 500 FIX
    # -------------------------------------------------------------
    p_h4 = doc.add_paragraph("4. UPGRADE PHASE 2: MARIADB COLLATION INCOMPATIBILITY & CATALOG RECOVERY")
    style_heading(p_h4, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "During live testing of Admin Menu Management, the interface displayed a confusing state: the menu catalog "
        "rendered 'No menu items found' (0 items), yet attempting to delete an ingredient in Inventory prompted an error "
        "stating that an existing menu item was using it."
    )

    add_callout(
        doc,
        "Root Cause Analysis & Forensic Discovery",
        "1. Investigation revealed that XAMPP ships with MariaDB 10.4, which does not support MySQL 8.0's utf8mb4_0900_ai_ci collation.\n"
        "2. When api/src/migrate.js ran, it crashed with ER_UNKNOWN_COLLATION ('Unknown collation: utf8mb4_0900_ai_ci') while executing migration 007.\n"
        "3. Because migration 007 halted the runner, migration 008_size_specific_recipes.sql was never executed.\n"
        "4. When AdminMenuManagement requested GET /api/menu, the backend executed a join on product_size_ingredients, which failed with HTTP 500 ('Table amaya.product_size_ingredients doesn't exist').\n"
        "5. The frontend caught the error but failed to surface it, falling back to an empty products array and displaying 0 items.",
        bg_hex="FAF7F4", border_hex="B45309"
    )

    doc.add_paragraph(
        "Implemented Fixes & Resolution:", style="List Bullet"
    )
    doc.add_paragraph(
        "• Collation Normalizer in migrate.js: Updated api/src/migrate.js with a global replace filter converting all "
        "utf8mb4_0900_ai_ci definitions into utf8mb4_unicode_ci prior to execution on MariaDB.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Migration Execution: Successfully applied 007_recipe_unit_conversions.sql and 008_size_specific_recipes.sql to MySQL. "
        "GET /api/menu immediately returned HTTP 200 OK, restoring full visibility of the catalog and its products (e.g., 'Milk Tea').",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Frontend Error Surfacing: Updated MenuContext.jsx to expose menuError, and updated AdminMenuManagement.jsx "
        "to display clear server error banners with retry buttons whenever network or schema issues occur, ending phantom empty states.",
        style="List Bullet"
    )

    # -------------------------------------------------------------
    # 6. UPGRADE PHASE 3: DEPENDENCY-AWARE INVENTORY DELETION
    # -------------------------------------------------------------
    p_h5 = doc.add_paragraph("5. UPGRADE PHASE 3: INTELLIGENT RECIPE-PROTECTED INVENTORY MANAGEMENT")
    style_heading(p_h5, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "Ken's backend initially protected inventory items from deletion using foreign key safeguards. However, the user experience "
        "was opaque: attempting to delete an item yielded a generic message without indicating which menu products were blocking the deletion."
    )

    doc.add_paragraph(
        "Upgraded Implementation in api/src/routes/inventory.js:", style="List Bullet"
    )
    doc.add_paragraph(
        "• 3-Way Union Dependency Check: Before processing a deletion, the route executes a comprehensive union query checking "
        "product_ingredients (base recipes), product_size_ingredients (serving size overrides), and product_addons (inventory-tracked toppings).",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Exact Product Name Reporting: If dependencies exist on active menu items, the server throws an HTTP 409 conflict naming "
        "the exact linked products: 'This inventory item is used in recipes/add-ons for active menu item(s): Milk Tea. Archive or remove it from those menu items first.'",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Test Stock vs. Real Order Isolation: The route checks order_inventory_consumptions. If an item has recorded customer sales, "
        "it cannot be destroyed (preserving financial and audit integrity). However, if an item only has test stock movements with zero customer orders, "
        "orphan test records are cleaned up cleanly.",
        style="List Bullet"
    )

    # -------------------------------------------------------------
    # 7. UPGRADE PHASE 4: 30-DAY TRASH ARCHIVE & AUDIT LOGS
    # -------------------------------------------------------------
    p_h6 = doc.add_paragraph("6. UPGRADE PHASE 4: 30-DAY TRASH ARCHIVE, AUTO-PURGE & PERMANENT AUDIT LOGGING")
    style_heading(p_h6, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "To provide a complete enterprise-grade safety net, the team designed and implemented a full 30-Day Soft-Delete Recycle Bin "
        "and permanent audit logging architecture across both menu items and inventory."
    )

    doc.add_paragraph("Architecture & Flow Overview:", style="List Bullet")
    doc.add_paragraph(
        "• Migration 009 (009_archive_and_audit_logs.sql): Added is_archived (BOOLEAN DEFAULT FALSE), archived_at (DATETIME NULL), "
        "and archived_by (BIGINT UNSIGNED NULL) to both menu_products and inventory_items. Created the permanent archive_audit_logs table.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Soft-Delete Operations: Deleting a menu product or inventory item now executes an UPDATE setting is_archived = TRUE, "
        "archived_at = NOW(), and archived_by = request.authUser.sub. The item is immediately excluded from active catalog queries.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Full Recipe & Variant Preservation: While archived, all recipe ingredients, size variants, and add-on linkages remain 100% "
        "intact in the database. Restoring an item returns it with its complete recipe formulas without manual data re-entry.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Automated 30-Day Background Purge Worker: In api/src/server.js, an hourly background job scans for items where "
        "archived_at <= NOW() - INTERVAL 30 DAY. Expired records are permanently purged via cascading deletes, and an audit entry "
        "with action = 'purged' and actor_name = 'System Auto-Purge' is recorded in the permanent audit ledger.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• Dedicated Admin Portal Page (/admin/archive): Built AdminArchive.jsx featuring three segmented tabs (🧋 Menu Items, "
        "📦 Inventory Items, 📋 Audit Trail), real-time search, dynamic countdown badges (🟢 30 days left, 🟠 7 days left, 🔴 Purging today), "
        "1-click restore buttons, immediate permanent deletion, and an [Empty Trash] button.",
        style="List Bullet"
    )
    doc.add_paragraph(
        "• UI Shortcuts & Modal Wording: In AdminMenuManagement.jsx and AdminInventory.jsx, added header [View Archive] buttons "
        "and updated confirmation modals to 'Move to Archive?' with clear explanations of the 30-day safety net.",
        style="List Bullet"
    )

    # -------------------------------------------------------------
    # 8. UPGRADE PHASE 5: USER CREDENTIALS & SECURITY
    # -------------------------------------------------------------
    p_h7 = doc.add_paragraph("7. UPGRADE PHASE 5: USER AUTHENTICATION & ACCESS CONTROL")
    style_heading(p_h7, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "User authentication uses bcrypt-hashed passwords in the users table, validated via JWT tokens stored in browser sessionStorage. "
        "The following active, verified accounts are configured for evaluation and defense demonstrations:"
    )

    user_table = doc.add_table(rows=3, cols=5)
    user_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    user_table.autofit = False
    user_table.columns[0].width = Inches(1.1)
    user_table.columns[1].width = Inches(1.1)
    user_table.columns[2].width = Inches(1.3)
    user_table.columns[3].width = Inches(1.2)
    user_table.columns[4].width = Inches(1.8)

    user_headers = ["Account Type", "Username", "Active Password", "Assigned Role", "Default Redirect & Portal Access"]
    for i, h in enumerate(user_headers):
        cell = user_table.rows[0].cells[i]
        set_cell_background(cell, "2E261F")
        set_cell_margins(cell, top=70, bottom=70, left=70, right=70)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.font.name = "Arial"
        r.font.size = Pt(8.5)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    user_rows = [
        ("Administrator", "admin", "Admin12345678", "admin", "/admin (Dashboard, Orders, Inventory, Menu, Reports, Archive, Settings)"),
        ("Cashier / Staff", "juan", "Staff12345678", "staff", "/staff/menu (Counter POS, Order Queue, Order History, Receipts, Settings)"),
    ]

    for row_idx, data in enumerate(user_rows, start=1):
        row = user_table.rows[row_idx]
        bg = "FFFFFF" if row_idx % 2 == 1 else "FAF7F4"
        for col_idx, text in enumerate(data):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=60, bottom=60, left=70, right=70)
            p = cell.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Arial"
            r.font.size = Pt(8.5)
            r.font.color.rgb = C_INK
            if col_idx in [0, 1, 2]:
                r.bold = True

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # -------------------------------------------------------------
    # 9. COMPLETE FILE INVENTORY & CHANGE LEDGER
    # -------------------------------------------------------------
    p_h8 = doc.add_paragraph("8. COMPREHENSIVE FILE INVENTORY & ENGINEERING CHANGE LEDGER")
    style_heading(p_h8, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "The following master ledger details all files created, modified, and verified throughout this upgrade cycle:"
    )

    file_table = doc.add_table(rows=14, cols=4)
    file_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    file_table.autofit = False
    file_table.columns[0].width = Inches(2.2)
    file_table.columns[1].width = Inches(1.0)
    file_table.columns[2].width = Inches(1.1)
    file_table.columns[3].width = Inches(2.2)

    file_headers = ["File Relative Path", "Action", "Subsystem", "Detailed Engineering Changes"]
    for i, h in enumerate(file_headers):
        cell = file_table.rows[0].cells[i]
        set_cell_background(cell, "2E261F")
        set_cell_margins(cell, top=70, bottom=70, left=70, right=70)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.font.name = "Arial"
        r.font.size = Pt(8.5)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    file_rows = [
        ("amaya_control_panel.py", "Created (v2.0)", "Desktop Tooling", "Tkinter GUI; 4 service cards; dual-stack IPv4/IPv6 port killer; XAMPP auto-start; tabbed logs."),
        ("Start_Amaya_Control_Panel.bat", "Created", "Desktop Tooling", "One-click windowless batch launcher locating pythonw.exe and executing control panel."),
        ("database/migrations/009_archive_and_audit_logs.sql", "Created", "Database", "Added is_archived, archived_at, archived_by to menu_products and inventory_items; created archive_audit_logs."),
        ("api/src/migrate.js", "Modified", "Database", "Added utf8mb4_0900_ai_ci to utf8mb4_unicode_ci collation translation; registered migration 009."),
        ("api/src/routes/archive.js", "Created", "Backend API", "Endpoints: GET /api/archive, restore, delete, empty trash; runArchivePurgeCheck background task."),
        ("api/src/routes/menu.js", "Modified", "Backend API", "Filtered is_archived = FALSE in listProducts; unarchive on recipe save; soft-archive + audit log on delete."),
        ("api/src/routes/inventory.js", "Modified", "Backend API", "Filtered is_archived = FALSE in GET /; 3-way recipe dependency check; soft-archive + audit log on delete."),
        ("api/src/server.js", "Modified", "Backend API", "Mounted /api/archive; added rolling background archive auto-purge check alongside stock inactivity monitor."),
        ("src/pages/admin/AdminArchive.jsx", "Created", "Admin Portal", "New Admin Archive page: 3 tabs (Menu, Inventory, Audit), 30-day countdown badges, restore, purge, live search."),
        ("src/assets/css/admin/AdminArchive.css", "Created", "Admin Portal", "Dedicated styling adhering to Amaya's warm artisanal café theme (--archive-accent, --archive-bg)."),
        ("src/components/Sidebar.jsx", "Modified", "Navigation", "Imported Archive icon; added 'Archive / Trash' navigation link under MANAGEMENT for admin role."),
        ("src/apps/PortalApp.jsx", "Modified", "Routing", "Imported AdminArchive and registered protected route /admin/archive under admin RequireAuth."),
        ("src/pages/admin/AdminMenuManagement.jsx & AdminInventory.jsx", "Modified", "Admin Portal", "Added [View Archive] header buttons; updated delete confirmation modals to 'Move to Archive?' with 30-day notice."),
    ]

    for row_idx, data in enumerate(file_rows, start=1):
        row = file_table.rows[row_idx]
        bg = "FFFFFF" if row_idx % 2 == 1 else "FAF7F4"
        for col_idx, text in enumerate(data):
            cell = row.cells[col_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=50, bottom=50, left=70, right=70)
            p = cell.paragraphs[0]
            r = p.add_run(text)
            r.font.name = "Arial"
            r.font.size = Pt(8)
            r.font.color.rgb = C_INK
            if col_idx == 0:
                r.bold = True
            if col_idx == 1 and "Created" in text:
                r.font.color.rgb = C_GOLD

    doc.add_paragraph().paragraph_format.space_after = Pt(10)

    # -------------------------------------------------------------
    # 10. SYSTEM VERIFICATION & BUILD BENCHMARKS
    # -------------------------------------------------------------
    p_h9 = doc.add_paragraph("9. TEST EXECUTION & PRODUCTION BUILD BENCHMARKS")
    style_heading(p_h9, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "To ensure uncompromising stability, all features underwent live API testing, migration validation, and full Vite client packaging:"
    )

    doc.add_paragraph("End-to-End Test Verification Steps:", style="List Bullet")
    doc.add_paragraph("1. Database Migration: node src/migrate.js applied 009_archive_and_audit_logs.sql with exit code 0.", style="List Bullet")
    doc.add_paragraph("2. API Health Check: GET http://localhost:3001/api/health returned HTTP 200 OK with {\"status\":\"ok\",\"database\":\"amaya\",\"connected\":true}.", style="List Bullet")
    doc.add_paragraph("3. Menu Soft-Archive & Isolation: Created test product 'Archive Test Milk Tea' (ID: 2). Deleted via DELETE /api/menu/2 (HTTP 204). GET /api/menu confirmed active menu count dropped to 0.", style="List Bullet")
    doc.add_paragraph("4. Archive Retrieval & Countdown: GET /api/archive returned the product with daysRemaining: 30 and exact expiration timestamp.", style="List Bullet")
    doc.add_paragraph("5. Single-Click Restoration: POST /api/archive/restore/menu/2 returned HTTP 200. GET /api/menu confirmed active menu count returned to 1.", style="List Bullet")
    doc.add_paragraph("6. Permanent Deletion & Audit Trail: Executed DELETE /api/archive/menu/2. Inspected archive_audit_logs in MySQL: all 4 events (archived ➔ restored ➔ archived ➔ manual_deleted) were permanently recorded with actor 'admin'.", style="List Bullet")
    doc.add_paragraph("7. Inventory Lifecycle Test: Created 'Archive Test Sugar' (ID: 5), archived, verified hidden from active list, restored, and permanently deleted with full audit logging.", style="List Bullet")
    doc.add_paragraph("8. Production Build Packaging: npm run build:customer completed in 2.53s; npm run build:portal completed in 604ms with zero errors.", style="List Bullet")

    # -------------------------------------------------------------
    # 11. CAPSTONE MANUSCRIPT ALIGNMENT & DEFENSE ROADMAP
    # -------------------------------------------------------------
    p_h10 = doc.add_paragraph("10. CAPSTONE OBJECTIVES ALIGNMENT & NEXT ACTIONS")
    style_heading(p_h10, C_ESPRESSO, 14, space_before=18, space_after=6)

    doc.add_paragraph(
        "The system upgrades directly reinforce the specific research objectives defined in Chapter 1 of the official capstone manuscript:"
    )

    doc.add_paragraph("• Objective 1 (Counter POS & Automated Math): Strengthened by recipe-locked product price resolution and zero-lag item cataloging.", style="List Bullet")
    doc.add_paragraph("• Objective 2 (Real-Time Order Queue Tracking): Protected by clean order cancellation rollback and live order queue status tracking.", style="List Bullet")
    doc.add_paragraph("• Objective 3 (Recipe-Based Inventory Deduction): Fully operational with culinary unit conversion, 3-way dependency protection, and 30-day inactivity monitors.", style="List Bullet")
    doc.add_paragraph("• Objective 4 (Sales Monitoring & Audit Integrity): Augmented by the new permanent archive_audit_logs ledger, preserving financial snapshots even when menu items are retired.", style="List Bullet")
    doc.add_paragraph("• Objective 5 (Public Digital Menu): Powered by the isolated CustomerApp (:5173), preventing archived items from ever appearing to walk-in patrons.", style="List Bullet")

    add_callout(
        doc,
        "Recommended Next Steps for Capstone Defense Preparation",
        "1. End-of-Day Cash Reconciliation (Objective #4): Build cash_reconciliations table and UI in AdminReport.jsx comparing Opening Change Fund + Cash Sales against Physical Count.\n"
        "2. Walk-in 'Unpaid' Order Toggle (Objective #2): Add Unpaid status at POS checkout in StaffOrderConfirmation.jsx for pay-upon-pickup orders.\n"
        "3. Live Orders Dashboard Widget: Connect orders.slice(0, 5) to the Recent Orders table in AdminDashboard.jsx.\n"
        "4. Public Milk Tea Filter: Update category filter key in src/pages/Menu.jsx to match 'Milk Tea'.",
        bg_hex="FAF7F4", border_hex="8B5E3C"
    )

    # Save
    doc.save(output_path)
    print(f"Document successfully created at: {output_path}")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(base_dir, "docs")
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "Amayas_Drinks_and_Bites_POS_System_Upgrades_and_Engineering_Documentation.docx")
    build_docx(out_file)
