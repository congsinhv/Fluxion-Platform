# Design Guidelines

## Design System Overview

Fluxion Admin Console uses **Editorial Cream + Terracotta** — a warm, professional palette suitable for enterprise device management. No shadcn/ui or off-the-shelf component libraries; all components hand-built to ensure control and consistency.

**Design Philosophy:**
- Clarity over decoration.
- Warm, approachable colors (cream, terracotta) vs. cold blues/blacks.
- Generous whitespace and typography hierarchy.
- No emojis; SVG icons only.

---

## Color Palette

### Core Colors

| Name | Value | Usage |
|------|-------|-------|
| **sidebar** | #ebe2cc | Sidebar background (aged paper) |
| **sidebar-2** | #e3d9be | Sidebar hover/active states |
| **sidebar-hover** | rgba(0,0,0,.04) | Sidebar nav item hover overlay |
| **bg** | #f4f1ea | Page background |
| **paper** | #ffffff | Card, modal, input backgrounds |
| **paper-2** | #fbf8f1 | Secondary card background |
| **ink** | #1a1a1a | Primary text (near black) |
| **ink-soft** | #3a3a3a | Secondary text, nav items |
| **muted** | #7a7466 | Disabled text, placeholders, hints |
| **rule** | #e4ddca | Borders, dividers |
| **rule-2** | #d9d2c2 | Secondary borders, thinner dividers |
| **accent** | #c44a2c | Primary action (terracotta) |
| **accent-dark** | #8a2f1a | Accent hover/active |
| **accent-soft** | #fdeee8 | Accent background, highlights |

### State Colors

| State | Color | BG Tint | Usage |
|-------|-------|---------|-------|
| idle | #9a9389 | #f1efea | Unprovisioned device (Inventory only) |
| registered | #b88a3a | #fbf2dd | Device claimed but not yet enrolled |
| enrolled | #3a4a8c | #e7ecf7 | Device enrolled, awaiting deployment |
| active | #2a6f5b | #e2f0e8 | Active, managing profile |
| locked | #b04545 | #fbe5e5 | Locked (financing hold or remote lock) |
| released | #6a6a6a | #ececec | Released from service |

**Usage:** Device state badges + timeline milestones use these colors. BG tints used for context backgrounds (e.g., device card detail).

### Intent Colors

| Intent | Value | Usage |
|--------|-------|-------|
| **Error/Danger** | #b04545 (state-locked) | Delete buttons, destructive actions, error messages |
| **Success** | #2a6f5b (state-active) | Success toast, checkmarks |
| **Warning** | #b88a3a (state-registered) | Warning toast, caution messages |
| **Info** | #3a4a8c (state-enrolled) | Info toast, neutral messages |

---

## Typography

### Fonts

| Role | Font | Stack | Usage |
|------|------|-------|-------|
| **Body** | Inter | Inter, system-ui, sans-serif | All text content |
| **Monospace** | JetBrains Mono | JetBrains Mono, ui-monospace, monospace | Device IDs, timestamps, code (if any) |

**Font Sizes:**

| Size | Px | Rem | Usage |
|------|----|----|-------|
| xs | 10px | 0.625rem | .text-xxs — hints, metadata, timestamps |
| xs | 12px | 0.75rem | .text-xs — labels, captions |
| sm | 14px | 0.875rem | .text-sm — secondary text, nav items |
| base | 16px | 1rem | Default body text |
| lg | 18px | 1.125rem | Subheadings, card titles |
| xl | 20px | 1.25rem | Page titles, modals |
| 2xl | 24px | 1.5rem | Page headers |

**Font Weights:**

| Weight | Value | Usage |
|--------|-------|-------|
| Regular | 400 | Body text |
| Medium | 500 | Button text, nav items, field labels |
| Semibold | 600 | Subheadings, emphasis |
| Bold | 700 | Page titles, strong emphasis (rare) |

### Line Height

| Context | Value | Usage |
|---------|-------|-------|
| Heading | 1.2 | Tight line height for titles |
| Body | 1.5 | Comfortable reading for paragraphs |
| Form labels | 1.4 | Slightly loose for scanning |

---

## Component Classes

### Buttons

#### .btn (Base)
```css
.btn {
  @apply inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed;
}
```

**HTML:**
```html
<button class="btn-primary">Save</button>
<button class="btn-primary" disabled>Saving...</button>
```

#### .btn-primary
```css
.btn-primary { 
  @apply btn bg-accent text-white hover:opacity-90; 
}
```
**Usage:** Primary action (Save, Submit, Dispatch Action).
**States:** hover: reduced opacity; disabled: 50% opacity.

#### .btn-secondary
```css
.btn-secondary { 
  @apply btn bg-paper border border-rule text-ink-soft hover:bg-paper-2; 
}
```
**Usage:** Secondary action (Cancel, Reset, Learn More).
**States:** hover: bg-paper-2; disabled: 50% opacity.

#### .btn-danger
```css
.btn-danger { 
  @apply btn bg-state-locked text-white hover:opacity-90; 
}
```
**Usage:** Destructive action (Delete, Release, Discard).
**Confirmation:** Always require confirmation modal before destructive action.

### Form Inputs

#### .input
```css
.input {
  @apply w-full px-3 py-2 rounded-md border border-rule bg-paper text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent;
}
```

**HTML:**
```html
<input type="text" class="input" placeholder="Search devices..." />
<textarea class="input" rows="4"></textarea>
<select class="input">
  <option>Option 1</option>
</select>
```

**States:**
- **Default:** border-rule, bg-paper.
- **Focus:** ring-accent/30, border-accent (blue focus ring).
- **Disabled:** opacity-50, cursor-not-allowed (via :disabled).
- **Error:** border-state-locked (red), optional error text below.

### Cards & Containers

#### .card
```css
.card {
  @apply bg-paper border border-rule rounded-lg shadow-sm;
}
```

**HTML:**
```html
<div class="card p-4">
  <h3 class="text-lg font-semibold">Device Detail</h3>
  <p class="text-sm text-muted">IMEI: 123456789012345</p>
</div>
```

**Variants:**
- **Padding:** p-4 (default), p-6 (spacious).
- **Background:** bg-paper (white), bg-paper-2 (off-white, for secondary content).

### Pills & Badges

#### .pill
```css
.pill {
  @apply inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium;
}
```

**State Badges:**
```html
<span class="pill bg-state-idle text-ink">Idle</span>
<span class="pill bg-state-active text-white">Active</span>
<span class="pill bg-state-locked text-white">Locked</span>
```

**With Icons:**
```html
<span class="pill bg-accent text-white gap-1">
  <IconCheck class="w-3 h-3" />
  Dispatched
</span>
```

### Spacing

**Padding & Margin Scale:**
| Class | Value | Usage |
|-------|-------|-------|
| p-2 | 0.5rem | Tight padding (pill, label) |
| p-3 | 0.75rem | Button padding |
| p-4 | 1rem | Card padding (default) |
| p-6 | 1.5rem | Card padding (spacious) |
| gap-2 | 0.5rem | Small gap (icon + text) |
| gap-3 | 0.75rem | Medium gap (nav item) |
| gap-4 | 1rem | Large gap (section spacing) |

---

## Icons

### Icon Policy
- **No Emoji:** UI uses SVG icons only (from `src/components/icons.tsx`).
- **Inline SVG:** All icons are hand-drawn (no icon libraries).
- **Size:** 16px (4 tailwind units), 20px (5 units), or 24px (6 units).
- **Color:** Inherit text color (or explicit class).

### Icon Set

**Navigation Icons:**
- IconBox (Inventory)
- IconCard (Device Financing)
- IconLayers (States)
- IconBolt (Actions)
- IconTemplate (Templates)
- IconTag (TACs)
- IconUpload (Upload)
- IconHistory (History)

**Action Icons:**
- IconChevronRight (Expand/Next)
- IconLogout (Sign Out)
- IconCheck (Success/Confirm)
- IconX (Close/Cancel)

**State Icons:**
- (State badges use color only; no icon overlays)

### Icon Usage

```html
<!-- Navigation link -->
<a href="/upload" class="flex items-center gap-2">
  <IconUpload class="w-4 h-4" />
  <span>Upload IMEI</span>
</a>

<!-- Inline button icon -->
<button class="btn-primary flex items-center gap-2">
  <IconCheck class="w-4 h-4" />
  Dispatch
</button>

<!-- Standalone icon (no label) -->
<IconChevronRight class="w-5 h-5 text-muted" />
```

---

## Layout & Spacing

### Grid Layout (Shell)
```html
<div class="grid grid-cols-[260px_1fr] min-h-screen">
  <aside class="sticky top-0 h-screen bg-sidebar">
    <!-- Sidebar nav -->
  </aside>
  <main class="bg-bg">
    <!-- Page content -->
  </main>
</div>
```

**Sidebar Width:** 260px (fixed).
**Sticky:** Sidebar sticks to top on scroll.
**Responsive:** No mobile breakpoints in MVP (tablet+ target).

### Page Layout
```html
<div class="p-6 max-w-7xl mx-auto">
  <PageHeader title="Devices" />
  <!-- Content -->
</div>
```

**Page Padding:** p-6 (1.5rem) horizontal + vertical.
**Max Width:** max-w-7xl (80rem) for wide screens.
**Centering:** mx-auto to center content.

### Section Spacing
```html
<div class="space-y-6">
  <section>
    <h2 class="text-lg font-semibold mb-4">Section Title</h2>
    {/* content */}
  </section>
  <section>
    {/* another section */}
  </section>
</div>
```

**Vertical Spacing:** space-y-6 (1.5rem between sections).
**Section Gap:** mb-4 (1rem between heading + content).

---

## Modals & Dialogs

### Modal Structure
```html
<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-paper rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
    <h2 class="text-xl font-semibold mb-4">Confirm Action</h2>
    <p class="text-sm text-ink-soft mb-6">Are you sure?</p>
    <div class="flex gap-3 justify-end">
      <button class="btn-secondary">Cancel</button>
      <button class="btn-danger">Confirm</button>
    </div>
  </div>
</div>
```

**Overlay:** Fixed position, semi-transparent black (bg-black/50).
**Content:** Centered, max-w-md, rounded-lg card.
**Actions:** Right-aligned, secondary + primary/danger buttons.

### Toast Notifications

**Styles:**
```css
/* Success */
.toast-success { @apply bg-state-active text-white; }
/* Error */
.toast-error { @apply bg-state-locked text-white; }
/* Warning */
.toast-warning { @apply bg-state-registered text-ink; }
/* Info */
.toast-info { @apply bg-state-enrolled text-white; }
```

**Position:** Bottom-right, fixed (or top-right per UX choice).
**Duration:** 4-5 seconds (auto-dismiss).
**Stacking:** Multiple toasts stack vertically.

---

## Accessibility

### Color Contrast
All text must meet WCAG AA contrast ratios:
- **ink (#1a1a1a) on paper (#ffffff):** 18:1 ✓
- **ink-soft (#3a3a3a) on paper (#ffffff):** 15:1 ✓
- **muted (#7a7466) on paper (#ffffff):** 4.5:1 ✓
- **white text on accent (#c44a2c):** 4.8:1 ✓

### Keyboard Navigation
- **Tab order:** Sidebar nav → Main content → Footer.
- **Focus visible:** Default browser focus ring (or custom ring-accent if needed).
- **Modals:** Focus trap (Tab cycles within modal; Escape closes).

### Screen Reader Support
- **Semantic HTML:** `<button>`, `<input>`, `<nav>`, `<main>`, `<article>`.
- **ARIA labels:** For icons: `aria-label="Close modal"`.
- **Implicit semantics:** Prefer `<button>` over `<div onclick>`.

### Motion & Animation
- **Reduced motion:** Respect prefers-reduced-motion media query.
- **No auto-play:** Videos, animations only on user interaction.
- **Transitions:** Keep under 300ms (quick, not jarring).

---

## Dark Mode (Future)

Currently not implemented. If adding dark mode:

**Dark Palette (Proposal):**
| Light | Dark | Usage |
|-------|------|-------|
| #ffffff (paper) | #1a1a1a (ink) | Backgrounds swap |
| #1a1a1a (ink) | #ffffff (paper) | Text swaps |
| #ebe2cc (sidebar) | #2a2a2a | Dark sidebar |

**Implementation:** Tailwind dark: mode (class or media).

---

## Responsive Design (Future)

MVP targets tablet+ (768px+). Mobile breakpoints:

```css
/* sm: 640px */
@apply sm:grid-cols-2 sm:p-4

/* md: 768px */
@apply md:grid-cols-3 md:p-6

/* lg: 1024px */
@apply lg:max-w-7xl

/* xl: 1280px */
@apply xl:grid-cols-4
```

Currently all breakpoints omitted (assume tablet+).

---

## Design Tokens Reference

### Copy-Paste: Design Tokens CSS
```css
/* src/styles/tokens.css */
:root {
  --color-sidebar: #ebe2cc;
  --color-bg: #f4f1ea;
  --color-paper: #ffffff;
  --color-ink: #1a1a1a;
  --color-accent: #c44a2c;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}
```

### Copy-Paste: Tailwind Config
```typescript
// tailwind.config.ts
const config: Config = {
  theme: {
    extend: {
      colors: {
        sidebar: "#ebe2cc",
        bg: "#f4f1ea",
        paper: "#ffffff",
        ink: "#1a1a1a",
        accent: "#c44a2c",
        // ... (full list in tailwind.config.ts)
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
};
```

---

## Brand Assets

### Logo
- **File:** `public/logo.svg`.
- **Dimensions:** 30px × 30px (shown in sidebar brand area).
- **Color:** Full color (no monochrome variant in MVP).

### Wordmark
- **Text:** "Fluxion" (sidebar).
- **Subtitle:** "MDM Console" (uppercase, monospace, muted color).

---

## Design Checklist

When adding new UI:
- [ ] Uses design tokens (colors, fonts, spacing from config).
- [ ] Buttons follow .btn-primary / .btn-secondary / .btn-danger pattern.
- [ ] Forms use .input class (not custom input).
- [ ] Cards use .card class (not custom card div).
- [ ] Icons are SVG from icons.tsx (no emoji, no external icon libs).
- [ ] No hardcoded colors (all from tailwind.config.ts).
- [ ] Contrast meets WCAG AA (4.5:1 minimum for body text).
- [ ] Focus states visible (ring-accent on inputs/buttons).
- [ ] Responsive (if applicable): tested on tablet + wide screens.
- [ ] No red/green color-only feedback (icons + color for colorblind accessibility).

---

## Last Updated

2026-06-07
