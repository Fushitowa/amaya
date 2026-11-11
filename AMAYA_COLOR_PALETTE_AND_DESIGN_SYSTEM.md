# Amaya Atelier — Design System & Color Palette Guide
> **Official Brand, Color Palette & UI Architecture Reference**  
> *Generated on: November 12, 2026*  
> *Workspace: AMAYA Cafe & Bakery Management System*

---

## 1. Brand Concept & Aesthetic Vision

The visual identity of **Amaya** blends the charm of a sunlit Parisian café-atelier with the meticulous order of an artisanal Japanese workshop logbook. 

### Core Design Pillars:
1. **Warm Sunlit Paper & Parchment (Never Cold Pure Gray)**:
   Surfaces evoke archival cotton paper, smooth cardstock, and warm café tablecloths. Pure `#000000` is strictly forbidden; all dark elements use deep roasted mocha and espresso tones.
2. **Tactile Workshop Metaphors**:
   Physical elements include brass rivets, perforated tear-off slip rules, stitched logbook spines, numbered `#1`, `#2` pinned tabs, and bookmark ribbons.
3. **Harmonized Contrast & Clarity**:
   Clean separation between white card surfaces (`#ffffff`), warm ivory canvases (`#faf7f4`), deep coffee inks (`#24140b`), and pastel status badges (mint, peach, coral).
4. **Zero Layout Shift Motion**:
   All UI interactions use hardware-accelerated transforms (`transform`, `opacity`), zero `transition: all`, and explicit hover gating.

---

## 2. Master Color Palette

### A. Surfaces & Canvases (The Paper System)

| Token Name | Hex Code | RGB | Visual Role | Typical Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Paper Crisp White** | `#ffffff` | `rgb(255, 255, 255)` | Pure white card surface | Cards, inputs, table rows, modal inner sheets |
| **Atelier Warm Panel** | `#fffdf9` | `rgb(255, 253, 249)` | Subtle warm white | Logbook pages, notification detail sheets |
| **Sunlit Ivory Canvas** | `#faf7f4` | `rgb(250, 247, 244)` | Main application background | Page body, modal backdrop surfaces, outer wrap |
| **Warm Page Beige** | `#fcf9f2` | `rgb(252, 249, 242)` | Soft parchment tint | Category cards, secondary panel backgrounds |
| **Trough & Recessed Shelf** | `#f5efe6` | `rgb(245, 239, 230)` | Recessed utility backgrounds | Scale rulers, sub-headers, progress track troughs |
| **Modal Shadow Tint** | `rgba(24, 16, 12, 0.45)` | `rgba(24, 16, 12, 0.45)` | Backdrop blur overlay | Dialog backdrop curtain, ambient elevation |

---

### B. Inks & Typography (The Press Palette)

| Token Name | Hex Code | Visual Role | Typical Usage |
| :--- | :--- | :--- | :--- |
| **Deep Espresso Ink** | `#24140b` / `#2e261f` | Primary dark ink | Page titles, card headers, high-emphasis text |
| **Atelier Coffee Ink** | `#382518` / `#2d1f1a` | High-contrast secondary | Sub-headings, active tab text, field labels |
| **Warm Walnut Secondary** | `#5c4333` / `#584c46` | Medium readable text | Form input labels, helper text, descriptions |
| **Muted Sepia Ink** | `#857b72` / `#8a7c73` | Low-emphasis metadata | Timestamps, folio numbers, units, order counts |
| **Subtle Watermark** | `#bdaea1` | De-emphasized stamps | Background watermarks, inactive icons |

---

### C. Roasted Accents & Primary Brand Colors

| Token Name | Hex Code | Visual Role | Typical Usage |
| :--- | :--- | :--- | :--- |
| **Primary Mocha Dark** | `#2f241f` / `#2a170f` | Primary Brand Action | Main CTA buttons (`+ Add Item`), active filter pills |
| **Hover Mocha Deep** | `#473730` | Button Hover State | Primary button hover & focus |
| **Roasted Coffee Banner** | `#734c2c` / `#6e472a` | Solid Summary Bar | "Collected Total", "Unit Cost Headline", header seals |
| **Artisanal Leather Brown** | `#8b5e3c` / `#9b653c` | Warm Amber Brand Accent | Accent borders, link buttons, category highlights |
| **Honey Caramel Light** | `#c6a07f` / `#d8a25e` | Soft Accent | Secondary highlights, decorative ticks |

---

### D. Architectural Borders & Stitch Lines

| Token Name | Hex Code / RGBA | Visual Role | Typical Usage |
| :--- | :--- | :--- | :--- |
| **Hairline Paper Border** | `#ece4df` / `#efe5da` | Crisp subtle boundary | Card borders, table dividers, input borders |
| **Card Frame Border** | `#ded5cc` / `#ebdcd0` | Structural card outline | Modal frames, category bar outlines, dropdowns |
| **Dashed Stitch Rule** | `rgba(139, 94, 60, 0.16)` | Perforated / ledger tear | Logbook perforated dividers, docket tear strips |
| **Focus Ring Accent** | `rgba(139, 94, 60, 0.18)` | Interactive focus halo | Keyboard focus outlines (3px spread) |

---

### E. Metallic Champagne Brass (Hardware & Fasteners)

| Token Name | Hex Code | Visual Role | Typical Usage |
| :--- | :--- | :--- | :--- |
| **Champagne Brass Light** | `#f7e6c0` / `#f6e6bf` | Specular highlight | Clip brackets, metallic gradient tops |
| **Atelier Vintage Brass** | `#cfa165` / `#c49c5e` | Medallion & rivet body | Pin dot fasteners, clip plates, rank medallions |
| **Antique Burnished Brass** | `#8e6822` / `#94723a` | Shading & screw bevels | Rivet borders, screw head slots, hardware borders |

---

### F. Semantic Functional Badges (Pastel & High Contrast)

#### 1. Success / Active / Verified / Dine-In
- **Pill Background**: `#d4f7e5` (Solid) or `#eef8f1` (Soft)
- **Border**: `#bdebd0`
- **Text & Icon**: `#18602b` / `#22863a`
- **Indicator Dot**: `#2e7d32`
- *Usage*: `• Active`, `• Completed`, `Cost Verified`, `Active Requisition`

#### 2. Warning / Pending / Counter Tag
- **Pill Background**: `#fdf2e4`
- **Border**: `#f3dec6`
- **Text & Icon**: `#8c5625` / `#9b7140`
- *Usage*: Category count badges (`5 items`), `#1` index tag, Pending statuses

#### 3. Critical / Void / Danger / Stock Alert
- **Pill Background**: `#fde8e8` or `#f9e9e5`
- **Border**: `#fca5a5` / `#f0b5b5`
- **Text & Icon**: `#b83232` / `#96392c`
- *Usage*: Void Order buttons, Low Stock warnings, Delete modals

#### 4. Neutral / System Role / Custom Group
- **Pill Background**: `#f5eee8` or `#fbf7f1`
- **Border**: `#e6dad0`
- **Text & Icon**: `#3a2417` / `#5c4333`
- *Usage*: Category `Custom` role tag, docked unit badges (`g`, `ml`, `pcs`)

---

## 3. Typography Architecture

### Font Families
```css
/* Editorial Headings, Folio Headers, Modal Titles */
font-family: "Playfair Display", Georgia, serif;

/* Paris Literary Editorial (Notifications & Notes) */
font-family: "Cormorant Garamond", Georgia, serif;

/* Clean Application UI, Data Tables, Forms & Controls */
font-family: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

/* Quantities, Order IDs, Calculations, Tabular Ledger Data */
font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
font-variant-numeric: tabular-nums;
```

### Type Scale Rules
- **No Sub-12px Microtext**: Minimum floor is `12px` (`text-xs`) across the system for legible readability.
- **Eyebrow Tags**: `11px` or `12px`, uppercase, `font-weight: 800`, `letter-spacing: 0.8px` to `1.4px`.
- **Card / Row Titles**: `14px` to `16px`, `font-weight: 700`.
- **Modal & Sheet Headers**: `22px` to `26px`, *Playfair Display*, `font-weight: 700`.
- **Hero Figures (COGS / Unit Cost / Totals)**: `24px` to `28px`, *Playfair Display* with sans units.

---

## 4. UI Patterns & Architectural Styles

### Pattern 1: The Pinned Number Tag (Index Bars)
Seen in Menu Categories, Inventory Categories, and Requisition Dockets:
```css
.index-pin-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 8px;
  background: #f5eee8;
  border: 1px solid #e6dad0;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  color: #3a2417;
}

.index-pin-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, #f6e6bf, #c49c5e);
  border: 1px solid #94723a;
}
```

### Pattern 2: The Collected Total / Unit Cost Banner
High-contrast coffee banner providing clear visual anchor for calculation totals:
```css
.hero-total-banner {
  background: #734c2c;
  color: #ffffff;
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
```

### Pattern 3: The Primary CTA Button
Matches the `+ Add Inventory Category` & `Save Item` controls:
```css
.btn-primary-mocha {
  background: #2f241f;
  color: #ffffff;
  border: 1px solid #2f241f;
  border-radius: 10px;
  padding: 10px 22px;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
  box-shadow: 0 2px 6px rgba(47, 36, 31, 0.2);
  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), 
              background-color 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-primary-mocha:hover {
  background: #473730;
  transform: translateY(-1px);
}

.btn-primary-mocha:active {
  transform: translateY(1px) scale(0.98);
  transition-duration: 0ms;
}
```

### Pattern 4: Form Controls & Docked Badges
```css
.atelier-input {
  background: #ffffff;
  border: 1px solid #ded5cc;
  border-radius: 9px;
  min-height: 42px;
  padding: 0 12px;
  color: #2e261f;
  font-size: 13.5px;
}

.atelier-input:focus {
  outline: none;
  border-color: #8b5e3c;
  box-shadow: 0 0 0 3px rgba(139, 94, 60, 0.14);
}

.docked-unit-badge {
  background: #f5ede3;
  color: #5a3f2c;
  border: 1px solid #e4d7cb;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 800;
  padding: 3px 8px;
}
```

---

## 5. Ready-To-Use CSS Variables Block

```css
:root {
  /* Canvas & Surfaces */
  --amaya-surface-card: #ffffff;
  --amaya-surface-panel: #fffdf9;
  --amaya-surface-canvas: #faf7f4;
  --amaya-surface-subtle: #fcf9f2;
  --amaya-surface-recessed: #f5efe6;

  /* Inks */
  --amaya-ink-primary: #24140b;
  --amaya-ink-coffee: #2e261f;
  --amaya-ink-body: #5c4333;
  --amaya-ink-muted: #857b72;

  /* Roasted Brand Accents */
  --amaya-mocha-dark: #2f241f;
  --amaya-mocha-hover: #473730;
  --amaya-coffee-banner: #734c2c;
  --amaya-caramel-accent: #8b5e3c;

  /* Brass & Hardware */
  --amaya-brass-light: #f6e6bf;
  --amaya-brass-mid: #c49c5e;
  --amaya-brass-dark: #94723a;

  /* Boundaries */
  --amaya-border-hairline: #ece4df;
  --amaya-border-card: #ded5cc;
  --amaya-border-dashed: rgba(139, 94, 60, 0.16);
  --amaya-focus-ring: rgba(139, 94, 60, 0.14);

  /* Functional Badges */
  --amaya-badge-success-bg: #d4f7e5;
  --amaya-badge-success-ink: #18602b;
  --amaya-badge-warning-bg: #fdf2e4;
  --amaya-badge-warning-ink: #8c5625;
  --amaya-badge-danger-bg: #fde8e8;
  --amaya-badge-danger-ink: #b83232;
  --amaya-badge-neutral-bg: #f5eee8;
  --amaya-badge-neutral-ink: #3a2417;
}
```

---
*Amaya Atelier Design System · All tokens validated for high readability, responsive scaling, and cross-platform consistency.*
