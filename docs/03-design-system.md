# Design system

Extracted from the reference site's stylesheet and inline styles. Tokens are defined once in `apps/web/src/styles/tokens.css` (Tailwind `@theme`); component classes live in `apps/web/src/styles/components.css`; the admin panel has its own token set in `admin.css`.

## Colour

| Token (Tailwind) | Value | Use |
|---|---|---|
| `primary` | `#7C3AED` | Brand violet: primary buttons, active chips, focus rings |
| `primary-light` | `#9F5FFF` | Gradient end, links, card date |
| `primary-dark` | `#5B21B6` | Deep gradient stops |
| `primary-soft` | `#A78BFA` | Text on dark violet surfaces |
| `accent` / `accent-light` | `#F97316` / `#FB923C` | Ticket CTAs, hero eyebrow, podcast accents |
| `success` | `#22C55E` | Free price, success flash |
| `danger` | `#EF4444` | Errors, cancelled badge |
| `whatsapp` | `#25D366` | WhatsApp buttons and bubble |
| `pink` | `#EC4899` | Interest chip |
| `bg` / `bg-2` | `#080810` / `#0E0E1A` | Page / hero + footer background |
| `card` / `card-hover` | white 4 % / 8 % | Glass surfaces |
| `line` / `line-light` | white 8 % / 14 % | Borders |
| `ink` / `muted` / `faint` | `#F0F0FA` / `#8888A8` / `#4A4A6A` | Text hierarchy |

Gradients: button `135deg #7C3AED → #9F5FFF`; accent button `135deg #F97316 → #FB923C`; headline text `135deg primary-light → accent-light`; hero overlay `135deg rgba(26,5,51,.85) → rgba(8,8,16,.9) → rgba(13,26,58,.85)`. Category colours are data (per category, from the database) and are applied as `color + 22/44/cc` alpha suffixes for badge fill, border and count pill.

## Typography

- Display: **Outfit** (300–900) for headings, buttons, prices, logo text. Body: **DM Sans** (300–600).
- Base 16 px, body line-height 1.6; headings line-height 1.2, letter-spacing −0.02em, weight 700.

| Style | Size | Weight |
|---|---|---|
| `heading-xl` (hero) | `clamp(2.4rem, 6vw, 4.5rem)` | 900 |
| `heading-lg` | `clamp(1.8rem, 4vw, 3rem)` | 800 |
| `heading-md` | `clamp(1.3rem, 3vw, 2rem)` | 700 |
| Section title | 1.6rem | 800 |
| Card title | 1.1rem, 2-line clamp | 700 |
| Body / hero sub | 1rem / 1.15rem | 400 |
| Meta, card date | 0.8–0.85rem, uppercase, tracking 0.05em | 600 |
| Badge | 0.72rem, uppercase, tracking 0.04em | 700 |

## Spacing and layout

- Container: max 1180 px, 1rem gutters. Sections: 4rem vertical (2.5rem ≤640 px).
- Events grid: `repeat(auto-fill, minmax(300px, 1fr))`, gap 1.5rem; single column ≤640 px.
- Event detail: `1fr 340px`, gap 2.5rem, sidebar sticky at nav height + 1.5rem; single column ≤900 px.
- Footer grid: `2fr 1fr 1fr` → 2 columns ≤900 px → 1 column ≤640 px.
- Navbar height 64 px; filter bar sticks directly beneath it.

## Radius, elevation, motion

| Token | Value |
|---|---|
| `rounded-sm` | 8 px (inputs, pagination) |
| `rounded-card` | 14 px (drawer cards) |
| `rounded-lg` | 22 px (cards, glass boxes) |
| `rounded-xl` | 32 px (featured cards) |
| `rounded-pill` | 50 px (buttons, chips, badges, search) |
| `shadow-sm / md / lg` | `0 2px 8px /.4`, `0 8px 32px /.5`, `0 20px 60px /.6` black |
| `shadow-purple / accent` | `0 8px 32px` at 35 % of brand colour |

Motion: default transition `all .25s cubic-bezier(.4,0,.2,1)`; drawer and reveals use `cubic-bezier(.16,1,.3,1)`. Hover lifts: buttons −2 px, cards −6 px with image zoom 1.06. Scroll reveal (`slide-up`: 30 px, .8 s; `fade-in`). Hero slides cross-fade on a 12 s loop.

## Breakpoints

Reference media queries are max-width based; Tailwind's `max-*` variants map to them:

| Variant | Applies at | Main changes |
|---|---|---|
| `max-lg` | ≤ 900 px | Event detail and featured row stack; footer 2 columns |
| `max-md` | ≤ 768 px | Desktop nav buttons hidden, hamburger + drawer; logo 32 px |
| `max-sm` | ≤ 640 px | Nav search hidden; single-column grid; smaller hero |
| `max-xs` | ≤ 480 px | WhatsApp bubble icon-only |
| (≤ 400 / 380 px) | | Smaller large buttons / logo 28 px |

## Components

| Component | Class / file | Variants |
|---|---|---|
| Button | `.btn` | `btn-primary`, `btn-accent`, `btn-outline`, `btn-soft-purple`, `btn-icon`; sizes `btn-sm`, `btn-lg`; loading (`btn-spinner`, `is-submitting`) |
| Filter chip | `.filter-chip` (+ `.cat-count`) | default, hover, `active` |
| Event card | `EventCard.astro` → `.event-card` | exclusive ribbon, free, cancelled, with/without CTA |
| Badge / tag | `.badge` (`badge-cat`, `badge-free`, `badge-featured`, `badge-cancelled`), `.tag`, `.interest-chip` | |
| Surfaces | `.glass-box`, `.event-sidebar-card`, `.community-mini` | |
| Inputs | nav search pill, `.search-bar`, modal fields (8 px radius, white 20 % border, black 20 % fill) | focus: primary border + 3–4 px ring at 15 % |
| Feedback | `.flash-success|error|warning`, `.empty-state`, `.copy-toast`, `.shimmer` | |
| Navigation | `Navbar`, `MobileDrawer`, `FilterBar`, `Footer`, `.pagination` / `.page-btn` | |
| Overlays | `.auth-modal-overlay` + `.auth-modal` (login, profile), install banners, WhatsApp bubble, scroll-top | |

Admin components are listed in `docs/02-admin-recon.md` and styled in `admin.css` (`--a-*` tokens: background `#0F1117`, sidebar `#090B0F`, card `#181C27`, 10 px radius, base 15 px).

## Fidelity notes

- The component layer is a 1:1 port of the reference rules so shared elements render identically; page-specific inline styles were converted to Tailwind utilities.
- The reference hides card category badges globally (`.event-card-badges { display:none }`); the rebuild keeps both the markup and that rule.
- Three custom properties referenced by the reference CSS were never defined (`--text-color`, `--border-color`, `--bg-lighter`). The visible result — inherited text colour, no border, transparent background — is reproduced deliberately.
