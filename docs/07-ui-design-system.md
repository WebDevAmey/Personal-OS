# 07 — UI Design System

Status: Draft for review · Date: 2026-10-21
Consistent with: ADR-013 (shadcn on Base UI + Tailwind 4 + Motion; cmdk;
remove `framer-motion`), ADR-014 (landing figures via Anatomy), ADR-015
(voice), and `docs/00-product-spec.md` (behaviour this system must express).

Labels: **[VERIFIED]** = read in the repo or fetched from the web on
2026-10-21 (evidence given). **[ASSUMPTION]** = not verified. **[GAP]** =
current code differs from this spec.

---

## 1. Design intent

Personal OS is a tool someone opens many times a day. The interface should feel
like a well-made instrument: quiet, dense enough to scan, fast, and honest
about what the system knows versus what it guessed.

Rules that follow from that:

1. **Neutral first, one accent.** Grey scale carries the UI. One restrained
   blue accent marks the single thing to act on (primary action, focus,
   selection, current nav item). Colour otherwise means *status*, never
   decoration. No gradients in the app; no gradient text anywhere.
2. **Small radii, real borders.** 4–8 px corners, 1 px rules. No pill-shaped
   cards, no 24–32 px "bubbly" radii, no glassmorphism.
3. **Typography does the hierarchy.** Size/weight/colour steps, not boxes and
   shadows.
4. **Motion confirms, it does not perform.** Short, functional transitions;
   nothing loops in the app.
5. **Every state is designed.** Empty, loading, error, disconnected, offline,
   partial — each has copy and a visual (§12).

---

## 2. Research findings (2026-10-21)

### 2.1 supermemory.ai — font and visual language

Evidence [VERIFIED, raw HTML and `/_astro/index.D6YoOPHk.css` fetched via a
scraping proxy because direct `curl` was blocked by the sandbox proxy]:

- `<meta name="generator" content="Astro v7.3.1">` — an Astro site.
- `<link rel="preload" href="https://supermemory.ai/fonts/Geist-var.woff2" as="font" type="font/woff2" crossorigin>`
  and the same for `/fonts/GeistMono-var.woff2`.
- Inline CSS:
  `@font-face { font-family: Geist; font-style: normal; font-weight: 100 900; font-display: swap; src: url("/fonts/Geist-var.woff2") format("woff2"); }`
  and `@font-face { font-family: "Geist Mono"; … src: url("/fonts/GeistMono-var.woff2") … }`.
- The stylesheet uses `font-family: var(--font)` (3×) and
  `font-family: var(--font-mono)` (16×). The value of `--font` is defined in a
  stylesheet not fetched; given the only faces declared and preloaded are
  Geist and Geist Mono, the site's text face is **Geist** (variable, 100–900)
  and its meta/label face is **Geist Mono**.
- Other tokens seen in that CSS: `--logo-ink:#141b34`, `--link-start:#0042af`,
  `--blue-press:#033a9a`, `--link-frame:#0562ef66`, `--tick:#9ec6f7`,
  `--live:#00c763`; `border-radius` values are mostly `0`, one `8px`, one
  `1px`. So: near-square geometry, thin rules (`border:1px solid var(--rule)`),
  a single blue accent, a green "live" indicator, and heavy use of mono for
  labels.

**Licence:** Geist and Geist Mono are by Vercel, "free and open sourced under
the SIL Open Font License" (geist npm README, `cdn.jsdelivr.net/npm/geist@1.7.2/README.md`)
[VERIFIED]. Not a commercial font, so no substitute is needed.

**Decision:** keep **Geist** (sans) and **Geist Mono** loaded through
`next/font/google` exactly as `app/layout.tsx` already does [VERIFIED:
`Geist({ variable: "--font-geist-sans" })`, `Geist_Mono({ variable: "--font-geist-mono" })`].
Self-hosted by Next at build time, zero runtime requests to Google, automatic
`size-adjust` fallback (no CLS). We adopt supermemory's *language* (square-ish
geometry, rules over shadows, one blue, mono meta) but not its exact colours.

### 2.2 Component sources

| Source | Exists? | What it is | Licence | Install model | React 19 / Tailwind 4 / shadcn-on-Base-UI fit | Decision |
|---|---|---|---|---|---|---|
| **Magic UI** (magicui.design) | Yes [VERIFIED] | Animated effects/components for landing pages; GitHub `magicuidesign/magicui`, ~22.8k stars | **MIT** (repo LICENSE) [VERIFIED] | shadcn CLI: `pnpm dlx shadcn@latest add @magicui/<name>` [VERIFIED docs]; source copied | Registry items depend on `motion` and import `motion/react` (e.g. `r/number-ticker.json`: `"dependencies": ["motion"]`) [VERIFIED]. Tailwind 4 / React 19 support [ASSUMPTION: not stated on pages fetched; check each item's classes]. Most items are standalone (no Radix), so they coexist with Base UI. | Copy individual items only for the landing page when they add clear value (ADR-013). None required for the app. |
| **21st.dev** | Yes [VERIFIED] | Community catalogue/registry ("12,000+ … React components, templates, and shadcn themes"); every component has an author; code is copied into your repo | **Per author; no blanket licence stated** on the homepage [VERIFIED absence]. Some templates are paid. | Per-component shadcn CLI command or "AI prompt" copy | Varies per component; many assume Radix primitives | Reference only unless the specific component's licence is checked and recorded in the file header. |
| **beUI** (beui.dev) | Yes [VERIFIED] | "Copy-paste components for React and Next.js, built with Motion and Tailwind CSS"; also React Native | **MIT** for the public library ("including commercial use and modification", keep notice); beUI Pro separate paid licence [VERIFIED] | shadcn registry (`shadcn add @beui/<name>`) or copy | Built for **React 19** and **Tailwind CSS 4**, on Motion [VERIFIED] | Already used: `components/motion/command-palette.tsx` (header `// beui.dev/components/blocks/command-palette`), `lib/ease.ts`, `lib/hooks/*`, `lib/presence-gate.tsx` [VERIFIED]. Keep `lib/ease.ts` and hooks. [GAP] add the MIT notice to copied files. |
| **Arc** (uiarc.dev) | Yes [VERIFIED] | "Animated React components and blocks for shadcn and Next.js" — 182 components, 109 blocks; claims reduced-motion support | Free source **MIT**; **Arc Pro** $199 one-off, personal seat, no redistribution, may not be used to build a UI kit/design system [VERIFIED `/license`] | shadcn CLI or copy | React/Next/shadcn; versions not stated | Reference only (ADR-013). Never copy Pro source. |
| **BoardUI** (boardui.com) | Yes [VERIFIED] | "React design system for agentic interfaces/dashboards": 85 components, 19 charts, 400+ tokens, Figma file; GitHub `BoardUI/boardui` (~643 stars) | **MIT** (repo) [VERIFIED]; Pro templates paid | Own CLI: `npx boardui@latest add <name>` [VERIFIED] | React 19.2, Tailwind 4 — but built on **React Aria Components**, a different primitive layer [VERIFIED] | Reference only (ADR-013): mixing React Aria and Base UI duplicates focus/overlay management. Useful reference for date picker, meeting scheduler and dashboard density. |
| **Vengeance UI** (vengeanceui.com; OG URL `vengenceui.com`) | Yes [VERIFIED] | "Animated React components and next-generation UI interactions for modern landing pages" | Site says "Every component is open source", **no licence named** on homepage or docs; source repo not located [VERIFIED absence] | `npx shadcn@latest add @vengeanceui/<component>` [VERIFIED] | Versions not stated; existing copied component uses `framer-motion` | Reference only. `components/ui/animated-tooltip.tsx` (credited to VengeanceUI in `command-bar.tsx`, imports `framer-motion`) is removed (§16). |

---

## 3. Existing UI audit — keep / change

[VERIFIED by reading the files named]

| Item | Verdict | Reason |
|---|---|---|
| `components.json` style `base-nova`, `baseColor: neutral`, `iconLibrary: lucide`, CSS variables | **Keep** | Correct foundation for shadcn on Base UI. |
| `app/globals.css` structure: `@import "tailwindcss"`, `tw-animate-css`, `shadcn/tailwind.css`, `@custom-variant dark (&:is(.dark *))`, `@theme inline` mapping, OKLCH neutrals | **Keep structure, replace values** | Tokens are the shadcn defaults: no brand accent, no status/priority colours, `--radius: 0.625rem` (10 px → `rounded-xl` cards at 14 px). Replace with §5–§7. |
| `app/layout.tsx` Geist + Geist Mono via `next/font/google`, `lang="en"`, global `<CommandBar />` | **Keep fonts and lang**; move `<CommandBar />` into the authenticated app shell | The palette calls `/api/command`, which needs a session; it should not mount on the landing or auth pages. No theme handling yet (add §5.4). |
| `components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `dialog.tsx`, `separator.tsx`, `badge.tsx`, `card.tsx`, `input-group.tsx` (shadcn base-nova on `@base-ui/react`) | **Keep** | Good primitives with focus rings, `aria-invalid` styles, Base UI `data-open/closed` animation hooks. Card radius drops from `rounded-xl` to `rounded-lg` via the new `--radius`. |
| `components/ui/command.tsx` (cmdk inside Base UI Dialog) | **Keep** — the palette base (ADR-013) | |
| `components/motion/command-palette.tsx` (beUI block, own fuzzy match, own portal) | **Mine, then delete** | Two palettes is one too many. Take its motion values (`PANEL_SPRING` stiffness 560/damping 40), `useRowCursor`, `useOnOpen`, touch handling into `components/command-bar/`. |
| `components/command-bar/command-bar.tsx` | **Rewrite** | [GAP] auto-submits voice transcripts (ADR-015), emoji mic button, no states beyond "Thinking…", abuses `AnimatedTooltip` to show results, no `clientRequestId`, no Undo. |
| `lib/ease.ts` springs and curves | **Keep** — canonical motion tokens (§10) | |
| `components/ui/animated-tooltip.tsx` (framer-motion) | **Remove** | Duplicate animation library; playful SVG bubbles conflict with the visual language. |
| `components/ui/random-letter-swap.tsx`, `m-random-letter-swap-1.tsx` | **Remove** | Scrambles nav labels on hover: readability and screen-reader noise, no reduced-motion handling, source of the 3 lint warnings. |
| `components/hero/streak-widget.tsx` (framer-motion), `components/ui/section-separator.tsx`, `components/ui/stat-card.tsx` | **Remove** | Not referenced anywhere [VERIFIED by grep]; streak/gamification is not a V1 feature. |
| `components/hero/features-section.tsx` Lottie loader + `public/lottie/*.json` (472 KB) | **Replace** with Anatomy figures (§14) | `lottie-web` is 76.6 KB gzip for the player alone [VERIFIED: gzip of `lottie.min.js`], plus JSON fetched at runtime; animations are generic. |
| `components/ui/faq-accordion.tsx` | **Rebuild on Base UI `Accordion`** | Hand-rolled; use the primitive for correct `aria-expanded`/region semantics. |
| `public/A Man and a Laptop.webm`, `next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg` | **Remove** | Unreferenced create-next-app/demo leftovers [VERIFIED by grep]. |
| Auth pages (`app/sign-in/page.tsx` etc.) | **Keep layout**, restyle with tokens | Currently `bg-white`, `bg-neutral-900`, hard-coded neutrals; must use tokens for dark mode. |

---

## 4. Typography

### 4.1 Families

| Role | Family | Loaded as | Fallback stack |
|---|---|---|---|
| Sans (UI, body, display) | **Geist** variable 100–900 | `next/font/google` `Geist` → `--font-geist-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` |
| Mono (shortcuts, times, ids, meta labels) | **Geist Mono** variable | `Geist_Mono` → `--font-geist-mono` | `ui-monospace, "SF Mono", Menlo, monospace` |

Weights in use: 400 (body), 500 (UI labels, buttons), 600 (headings). No 700+
in the app; display may use 600 with tight tracking. Two families only.

### 4.2 Scale

App default body is 14 px (dense tool); landing body is 16–18 px.
Times, dates and counts use `font-variant-numeric: tabular-nums`.

| Token | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `text-display` | `clamp(2.5rem, 5.5vw, 3.5rem)` / 1.05 | 600 | -0.035em | Landing hero H1 only |
| `text-display-sm` | `clamp(1.875rem, 3.5vw, 2.5rem)` / 1.1 | 600 | -0.03em | Landing section H2 |
| `text-heading-lg` | 1.5rem (24) / 2rem | 600 | -0.02em | Page title (Today, Inbox) |
| `text-heading` | 1.125rem (18) / 1.625rem | 600 | -0.015em | Section title (Needs attention) |
| `text-heading-sm` | 0.9375rem (15) / 1.375rem | 600 | -0.01em | Card/sheet title, dialog title |
| `text-body-lg` | 1rem (16) / 1.5rem | 400 | 0 | Landing body, task sheet description |
| `text-body` | 0.875rem (14) / 1.25rem | 400 | 0 | App default, list rows |
| `text-body-sm` | 0.8125rem (13) / 1.125rem | 400 | 0 | Secondary text, reasons in briefing |
| `text-meta` | 0.75rem (12) / 1rem | 500 | 0.01em | Chips, timestamps, counts. Never smaller than 12 px. |
| `text-mono` | 0.8125rem (13) / 1.25rem, Geist Mono | 400–500 | 0 | `<kbd>`, times in agenda, ids |
| `text-mono-label` | 0.6875rem (11) / 1rem, Geist Mono, uppercase | 500 | 0.06em | Landing figure cards and section eyebrows only (≥ 4.5:1 colour required) |

Implemented as Tailwind 4 theme tokens (`--text-*` with `--line-height`
companions) in `app/globals.css` (§5.3).

Measure: prose ≤ 68ch; list rows truncate titles with ellipsis and expose the
full title via the row's accessible name.

---

## 5. Colour

### 5.1 Principles

- Neutral palette: zinc-like greys, very slightly cool, from `#FFFFFF` to
  `#18181B` (light) and `#0C0C0E` to `#EDEDF0` (dark).
- **One accent: "brand blue"** `#3155D6` light / `#8DA2FB` dark. Used for:
  primary button, focus ring, selected row indicator, current nav item, links,
  the Pending progress bar. Nowhere else.
- Semantic status colours (success, warning, danger) and priority colours are
  for *meaning*, always paired with an icon or text.
- Inference is shown with **neutral** dashed outline + text label, not colour
  (§11.3).

### 5.2 Token values and measured contrast

Contrast ratios computed with the WCAG 2.x relative-luminance formula
(script run 2026-10-21; values are ratios against the surfaces named).
Text requires ≥ 4.5:1; non-text UI (input borders, focus rings, icons that
carry meaning) ≥ 3:1. `--border` is decorative only (dividers between
already-distinguishable regions) and is exempt; interactive boundaries use
`--border-strong`.

**Light**

| Token | Value | vs `--background` #FFF | vs `--surface-2` #F5F5F4 | vs `--brand-subtle` #EEF2FD |
|---|---|---|---|---|
| `--foreground` | #18181B | 17.72 | 16.24 | 15.82 |
| `--muted-foreground` | #5B5B63 | 6.73 | 6.17 | 6.01 |
| `--subtle-foreground` | #67676F | 5.61 | 5.14 | 5.01 |
| `--brand` (text/link) | #3155D6 | 6.17 | 5.66 | 5.51 |
| `--brand-foreground` on `--brand` | #FFFFFF | 6.17 | — | — |
| `--success` | #15703A | 6.16 | 5.64 | — (on `--success-subtle` #EAF6EE: 5.55) |
| `--warning` | #A34A07 | 5.93 | 5.44 | — (on `--warning-subtle` #FDF3E7: 5.41) |
| `--danger` | #B91C1C | 6.47 | 5.93 | — (on `--danger-subtle` #FCECEC: 5.65; white on danger: 6.47) |
| `--priority-urgent` | #B91C1C | 6.47 | 5.93 | 5.78 |
| `--priority-high` | #B83D0B | 5.66 | 5.19 | 5.05 |
| `--priority-medium` | #8C5806 | 5.98 | 5.48 | 5.34 |
| `--priority-low` | #52525B | 7.73 | 7.09 | 6.90 |
| `--border-strong` (non-text) | #8B8B93 | 3.38 | 3.10 | 3.02 |
| `--border` (decorative) | #E4E4E7 | 1.27 | — | — |

**Dark**

| Token | Value | vs `--background` #0C0C0E | vs `--surface` #141417 | vs `--surface-2` #1C1C20 | vs `--brand-subtle` #1A2040 |
|---|---|---|---|---|---|
| `--foreground` | #EDEDF0 | 16.73 | 15.74 | 14.54 | 13.57 |
| `--muted-foreground` | #A1A1AA | 7.63 | 7.17 | 6.63 | 6.19 |
| `--subtle-foreground` | #8A8A93 | 5.71 | 5.37 | 4.96 | 4.63 |
| `--brand` | #8DA2FB | 8.09 | 7.61 | 7.03 | 6.56 |
| `--brand-foreground` on `--brand` | #0C0C0E | 8.09 | — | — | — |
| `--success` | #4ADE80 | 11.22 | 10.55 | 9.75 | (on #0F2A1A: 8.82) |
| `--warning` | #FBBF24 | 11.71 | 11.01 | 10.17 | (on #2E2208: 9.33) |
| `--danger` | #F87171 | 7.07 | 6.65 | 6.14 | (on #2E1414: 6.19; #0C0C0E on danger: 7.07) |
| `--priority-high` | #FB923C | 8.63 | 8.12 | 7.50 | 7.01 |
| `--priority-medium` | #FACC15 | 12.76 | 12.01 | 11.09 | 10.35 |
| `--priority-low` | #A1A1AA | 7.63 | 7.17 | 6.63 | 6.19 |
| `--border-strong` | #6E6E78 | 3.88 | 3.65 | 3.37 | 3.14 |
| `--border` | #2A2A30 | 1.37 | — | — | — |

Every text/surface pair above is ≥ 4.5:1; every non-text interactive pair is
≥ 3:1. Any new pair added later MUST be measured and appended here.

### 5.3 CSS (target `app/globals.css`)

Variable names keep the shadcn contract (`--background`, `--primary`,
`--accent`, `--ring`, …) so generated components work unchanged; new tokens
are added beside them. Note shadcn's `--accent` is the *hover surface*, not the
brand colour; the brand colour is `--brand`.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  /* fonts */
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --font-heading: var(--font-sans);

  /* type scale */
  --text-display: clamp(2.5rem, 5.5vw, 3.5rem);   --text-display--line-height: 1.05;  --text-display--letter-spacing: -0.035em;
  --text-display-sm: clamp(1.875rem, 3.5vw, 2.5rem); --text-display-sm--line-height: 1.1; --text-display-sm--letter-spacing: -0.03em;
  --text-heading-lg: 1.5rem;     --text-heading-lg--line-height: 2rem;      --text-heading-lg--letter-spacing: -0.02em;
  --text-heading: 1.125rem;      --text-heading--line-height: 1.625rem;     --text-heading--letter-spacing: -0.015em;
  --text-heading-sm: 0.9375rem;  --text-heading-sm--line-height: 1.375rem;  --text-heading-sm--letter-spacing: -0.01em;
  --text-body-lg: 1rem;          --text-body-lg--line-height: 1.5rem;
  --text-body: 0.875rem;         --text-body--line-height: 1.25rem;
  --text-body-sm: 0.8125rem;     --text-body-sm--line-height: 1.125rem;
  --text-meta: 0.75rem;          --text-meta--line-height: 1rem;            --text-meta--letter-spacing: 0.01em;

  /* shadcn contract */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);                 --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);           --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);           --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);       --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);               --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);             --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  /* sidebar-* mappings unchanged from the current file */

  /* additions */
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-border-strong: var(--border-strong);
  --color-brand: var(--brand);               --color-brand-foreground: var(--brand-foreground);
  --color-brand-subtle: var(--brand-subtle);
  --color-success: var(--success);           --color-success-subtle: var(--success-subtle);
  --color-warning: var(--warning);           --color-warning-subtle: var(--warning-subtle);
  --color-danger: var(--danger);             --color-danger-subtle: var(--danger-subtle);
  --color-priority-urgent: var(--priority-urgent);
  --color-priority-high: var(--priority-high);
  --color-priority-medium: var(--priority-medium);
  --color-priority-low: var(--priority-low);

  /* radii (base 6px) */
  --radius-sm: calc(var(--radius) * 0.667);  /* 4px  chips, kbd, checkboxes */
  --radius-md: calc(var(--radius) * 0.833);  /* 5px  buttons, inputs */
  --radius-lg: var(--radius);                /* 6px  cards, rows, popovers */
  --radius-xl: calc(var(--radius) * 1.333);  /* 8px  dialogs, palette, sheets */
  --radius-2xl: calc(var(--radius) * 1.333); /* clamp: no larger radius exists */
  --radius-3xl: calc(var(--radius) * 1.333);
  --radius-4xl: calc(var(--radius) * 1.333);

  /* elevation */
  --shadow-popover: 0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -8px rgb(0 0 0 / 0.16);
  --shadow-overlay: 0 2px 4px rgb(0 0 0 / 0.06), 0 24px 48px -12px rgb(0 0 0 / 0.24);
}

:root {
  color-scheme: light;
  --radius: 0.375rem;

  --background: #FFFFFF;
  --surface: #FFFFFF;          /* cards, rows */
  --surface-2: #F5F5F4;        /* sidebar, hover, muted panels */
  --foreground: #18181B;
  --muted-foreground: #5B5B63;
  --subtle-foreground: #67676F;
  --border: #E4E4E7;
  --border-strong: #8B8B93;

  --brand: #3155D6;
  --brand-foreground: #FFFFFF;
  --brand-subtle: #EEF2FD;

  --success: #15703A;  --success-subtle: #EAF6EE;
  --warning: #A34A07;  --warning-subtle: #FDF3E7;
  --danger:  #B91C1C;  --danger-subtle:  #FCECEC;

  --priority-urgent: #B91C1C;
  --priority-high:   #B83D0B;
  --priority-medium: #8C5806;
  --priority-low:    #52525B;

  /* shadcn contract mapped onto the above */
  --card: var(--surface);            --card-foreground: var(--foreground);
  --popover: var(--surface);         --popover-foreground: var(--foreground);
  --primary: var(--brand);           --primary-foreground: var(--brand-foreground);
  --secondary: var(--surface-2);     --secondary-foreground: var(--foreground);
  --muted: var(--surface-2);
  --accent: var(--surface-2);        --accent-foreground: var(--foreground);
  --destructive: var(--danger);
  --input: var(--border-strong);
  --ring: var(--brand);

  --sidebar: var(--surface-2);       --sidebar-foreground: var(--foreground);
  --sidebar-primary: var(--brand);   --sidebar-primary-foreground: var(--brand-foreground);
  --sidebar-accent: #EBEBEA;         --sidebar-accent-foreground: var(--foreground);
  --sidebar-border: var(--border);   --sidebar-ring: var(--brand);

  --chart-1: var(--brand); --chart-2: #5B5B63; --chart-3: #8B8B93; --chart-4: #B4B4BB; --chart-5: #D4D4D8;
}

.dark {
  color-scheme: dark;
  --background: #0C0C0E;
  --surface: #141417;
  --surface-2: #1C1C20;
  --foreground: #EDEDF0;
  --muted-foreground: #A1A1AA;
  --subtle-foreground: #8A8A93;
  --border: #2A2A30;
  --border-strong: #6E6E78;

  --brand: #8DA2FB;
  --brand-foreground: #0C0C0E;
  --brand-subtle: #1A2040;

  --success: #4ADE80;  --success-subtle: #0F2A1A;
  --warning: #FBBF24;  --warning-subtle: #2E2208;
  --danger:  #F87171;  --danger-subtle:  #2E1414;

  --priority-urgent: #F87171;
  --priority-high:   #FB923C;
  --priority-medium: #FACC15;
  --priority-low:    #A1A1AA;

  --sidebar: #111114;
  --sidebar-accent: #222227;

  --shadow-popover: 0 0 0 1px var(--border), 0 12px 32px -8px rgb(0 0 0 / 0.6);
  --shadow-overlay: 0 0 0 1px var(--border), 0 24px 64px -12px rgb(0 0 0 / 0.7);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  html { @apply font-sans; text-rendering: optimizeLegibility; }
  body { @apply bg-background text-foreground text-body antialiased; }
  :where(time, .tabular, td) { font-variant-numeric: tabular-nums; }
  ::selection { background: color-mix(in oklab, var(--brand) 22%, transparent); }
}
```

Lint rule (to add to `eslint.config.mjs`): forbid raw palette classes
(`bg-white`, `text-neutral-*`, `bg-violet-*`, `from-*`/`to-*` gradients,
`rounded-2xl|3xl|[28px]`) under `app/(app)/**` and `components/**` except
`components/landing/**`. [GAP] current auth pages and hero use raw
`bg-white`, `bg-neutral-900`, `text-neutral-600`, `#7B35F0` etc.

### 5.4 Theme switching

- Modes: `system` (default), `light`, `dark` — stored in `UserPreference.theme`
  and mirrored in a `theme` cookie so the server can render the right class on
  `<html>` without a flash.
- For signed-out pages (landing/auth) with no cookie, a ≤ 600-byte inline
  script in `app/layout.tsx` `<head>` sets `.dark` from `matchMedia('(prefers-color-scheme: dark)')`
  before first paint. No `next-themes` dependency needed.
- `color-scheme` is set per mode (above) so native form controls and
  scrollbars match.

---

## 6. Spacing, sizing and layout tokens

Tailwind 4 default `--spacing: 0.25rem`. Use only these steps in app code:
`0.5 1 1.5 2 3 4 5 6 8 10 12 16` (2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64 px).

| Token | Value | Use |
|---|---|---|
| Row height (list) | 36 px (`h-9`); comfortable mode 44 px | Task rows, nav items |
| Control heights | `xs` 24, `sm` 28, `default` 32, `lg` 36 px | Buttons/inputs (already in `button.tsx`) |
| Touch target min | 24×24 (WCAG 2.5.8); 40×40 for primary mobile actions | Icon buttons pad to 24 min |
| `--sidebar-w` | 240 px (collapsed 56 px) | App shell |
| `--topbar-h` | 48 px | App shell |
| `--content-max` | 960 px | List views |
| `--rail-w` | 320 px | Today schedule rail |
| `--sheet-w` | 440 px | Task detail sheet |
| `--palette-w` | min(640 px, 100vw − 32 px) | Command palette |
| Page padding | 24 px desktop, 16 px mobile | |
| Section gap | 32 px between page sections, 12 px between items in a section | |

## 7. Radii, borders, shadows

Revised 2026-10-27 (design board pass). The 8 px ceiling and the "cards have
no shadow" rule are retired: the app now sits on a light grey canvas and
content lives on white cards lifted by a soft shadow with a 1 px ring built
into it, instead of a border.

| Element | Radius | Border | Shadow |
|---|---|---|---|
| Chip / badge / kbd / checkbox | `rounded-sm` (4) | none | none |
| Button / input / select trigger / nav item | `rounded-lg` (8) | input: 1 px `--border` | none |
| Card / list group / panel | `rounded-xl` (12) | none | `shadow-card`, `shadow-card-hover` on hover |
| Menu / popover / toolbar | `rounded-xl` (12) | none | `shadow-popover` |
| Dialog / command palette / auth card | `rounded-2xl` (16) | none | `shadow-popover` or `shadow-overlay` |
| Landing tiles and promise cards | `rounded-3xl` (24) to `rounded-4xl` (32) | none | `shadow-card` |
| Pills, avatars, status dots | `rounded-full` | none | none |

Tokens (`app/globals.css`):

- `--canvas` (`#f7f7f8` light, `#0b0b0d` dark) is the page background;
  `--surface` is the card; `--surface-2` is a tinted well inside a card.
- `--elevation-card` = ring + 1 px contact shadow + soft 8 px falloff. In dark
  mode it is just the 1 px `--border` ring, since shadows vanish on black.
- Radii scale off `--radius: 0.5rem`: sm 0.5×, md 0.75×, lg 1×, xl 1.5×,
  2xl 2×, 3xl 3×, 4xl 4×.

Rules: nested corners stay concentric (inner radius = outer radius − padding).
No borders around cards; use a divider only between rows inside one card.

### 7.1 Display type and motion (2026-10-27)

- Page titles, auth titles and landing headings use Instrument Serif
  (`font-serif`, 400, italic for the emphasised half of a heading).
  Body and UI text stay on the sans.
- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. UI transitions run
  150–200 ms. Pressable things scale to 0.97 on `:active`.
- Things enter by rising 8 px, fading and unblurring 4 px. Nothing animates
  in from `scale(0)`. Popovers grow from `var(--transform-origin)`.
- Looping landing demos only run while on screen; with reduced motion they
  render their final frame.
- Confirmations borrow the decision-tree pattern: options hang off a rail
  with numbered chips, risk tiles are tinted by risk level, and the confirm
  button is the solid foreground pill (danger colour stays for destructive).

## 8. App shell

```
┌────────────┬──────────────────────────────────────────────┐
│  Sidebar   │ Topbar: page title · [Search or command… ⌘K] · │
│  240px     │         sync status · avatar menu              │
│            ├──────────────────────────────────┬───────────┤
│ Today      │ Main (max 960)                   │ Rail 320  │
│ Inbox   4  │  Today: Briefing → Today tasks   │ Today's   │
│ Upcoming   │                                  │ schedule  │
│ Overdue 2  │                                  │ (≥1280)   │
│ Completed  │                                  │           │
│ All        │                                  │           │
│ Projects ▸ │                                  │           │
│ ───        │                                  │           │
│ Settings   │                                  │           │
└────────────┴──────────────────────────────────┴───────────┘
             Task sheet (440) slides over from the right; Palette centred at 20vh
```

- Implemented in `app/(app)/layout.tsx` (replacing the Auth.js guard
  [VERIFIED current file calls `auth()`/`signOut()`]) with `getSession()`;
  the palette and quick-capture providers mount here, not in the root layout.
- Sidebar: Base UI `NavigationMenu` is not needed; a `<nav aria-label="Primary">`
  with links; counts are `text-meta` `--subtle-foreground`; Overdue count uses
  `--danger` text with a dot. Current item: `--brand` 2 px left bar + `--sidebar-accent`
  background + `aria-current="page"`.
- Topbar command trigger is a real button that looks like an input, showing
  `<kbd>⌘K</kbd>` (or `Ctrl K` on non-Mac, detected client-side after mount;
  server renders "Ctrl K"/"⌘K" neutral `K` to avoid hydration mismatch).
- Sync status: small dot + text "Synced 2 min ago" / "Offline" / "Reconnect
  Google".
- Mobile (< 768 px): sidebar becomes a Base UI `Drawer` from the left; topbar
  shows menu button, title and a command button; a bottom-right 48 px command
  button (icon `Command`) sits clear of content so it never obscures focus
  (2.4.11) — content gets bottom padding equal to its height.

## 9. Component inventory

Base UI primitives available [VERIFIED `node_modules/@base-ui/react` 1.7.0]:
accordion, alert-dialog, autocomplete, avatar, button, checkbox,
checkbox-group, collapsible, combobox, context-menu, dialog, drawer, field,
fieldset, form, input, menu, menubar, meter, navigation-menu, number-field,
otp-field, popover, preview-card, progress, radio, radio-group, scroll-area,
select, separator, slider, switch, tabs, toast, toggle, toggle-group, toolbar,
tooltip.

| Product component | File (target) | Built on | Notes |
|---|---|---|---|
| Button, IconButton | `components/ui/button.tsx` (exists) | `@base-ui/react/button` | Variants: primary (brand), secondary (surface-2), ghost, outline, destructive, link. IconButton requires `aria-label`. |
| Input, Textarea, InputGroup | exists | Base UI `input` | |
| Field (label/description/error) | `components/ui/field.tsx` | `field`, `fieldset` | All form fields; error text linked via `aria-describedby`. |
| OTP input | `components/ui/otp-field.tsx` | `otp-field` | 6 digits, paste, `autocomplete="one-time-code"`. |
| Checkbox | `components/ui/checkbox.tsx` | `checkbox` | Task completion uses a round checkbox variant (`rounded-full`, 16 px, 24 px hit area). |
| Select | `components/ui/select.tsx` | `select` | Priority, project pickers when not using combobox. |
| Combobox | `components/ui/combobox.tsx` | `combobox` | Project picker with "Create project…". |
| Menu, ContextMenu | `components/ui/menu.tsx` | `menu`, `context-menu` | Row "…" actions and right-click. |
| Popover | `components/ui/popover.tsx` | `popover` | Date/time picker container, snooze presets. |
| Date field | `components/tasks/date-field.tsx` | `popover` + text input + calendar grid (`react-day-picker`, §16) | Primary entry is natural language ("tomorrow 3pm") with live chrono preview line; grid for pointer users. |
| Dialog, AlertDialog | `dialog.tsx` (exists), `alert-dialog.tsx` | `dialog`, `alert-dialog` | AlertDialog for destructive/bulk confirmation in the UI (FR-261). |
| Sheet (task detail) | `components/ui/sheet.tsx` | `dialog` (modal on < 1280, non-modal side panel ≥ 1280) | Route `/tasks/[id]` intercepting route. |
| Drawer | `components/ui/drawer.tsx` | `drawer` | Mobile nav, mobile sheet. |
| Tabs | `components/ui/tabs.tsx` | `tabs` | Settings sections on mobile; Completed date ranges. |
| Toast | `components/ui/toast.tsx` | `toast` | Undo toasts, reminder toasts, palette results after close. Max 3 visible; Undo toasts 10 s; pause on hover/focus. |
| Tooltip | `components/ui/tooltip.tsx` | `tooltip` | Only for icon-button labels and truncated text; never the only place information lives. |
| Badge / Chip | `badge.tsx` (exists) | plain | Variants: neutral, brand, success, warning, danger, inferred (dashed). |
| Kbd | `components/ui/kbd.tsx` | plain | Geist Mono, `rounded-sm`, `--surface-2`, 1 px border. |
| Progress (indeterminate) | `components/ui/progress.tsx` | `progress` | Pending state bar. |
| Accordion | `components/ui/accordion.tsx` | `accordion` | Landing FAQ (replaces `faq-accordion.tsx`). |
| Scroll area | `scroll-area` | | Palette results, sidebar project list. |
| Switch | `switch` | | Settings toggles. |
| Avatar | `avatar` | | Account menu. |
| Command palette | `components/command-bar/*` | `components/ui/command.tsx` (cmdk) inside Base UI `dialog` | §11.1 |
| Task row | `components/tasks/task-row.tsx` | checkbox + menu | Anatomy: checkbox · title · chips (project, tags) · meta (due, recurrence, reminder, blocked) · priority glyph · hover actions. |
| Task list | `components/tasks/task-list.tsx` (exists, rewrite) | `role="list"`; selection via `aria-selected` in a grid pattern only if multi-select active | Roving tabindex (`lib/hooks/use-row-cursor.ts` exists). |
| Briefing | `components/briefing/*` (rewrite) | Card sections | §11.3 |
| Agenda rail | `components/calendar/agenda.tsx` | list | Times in Geist Mono tabular. |
| Source chip | `components/briefing/source-chip.tsx` | link | Icon + label; external links get `ExternalLink` icon and "(opens Gmail)" in accessible name. |
| Empty / Error / Disconnected panels | `components/states/*` | plain | §12 |
| Quick capture | `components/capture/quick-capture.tsx` | Base UI `dialog` (non-modal popover at top) | Token chips highlighted inline. |
| Voice button | `components/command-bar/voice-button.tsx` | `toggle` | `aria-pressed`, states §11.2. |

## 10. Motion

### 10.1 Tokens (keep `lib/ease.ts` [VERIFIED])

| Token | Value | Use |
|---|---|---|
| `--ease-out` / `EASE_OUT` | `cubic-bezier(0.16, 1, 0.3, 1)` | Entrances, expansions |
| `--ease-in-out` / `EASE_IN_OUT` | `cubic-bezier(0.77, 0, 0.175, 1)` | Moves between two resting positions |
| `--ease-drawer` / `EASE_DRAWER` | `cubic-bezier(0.32, 0.72, 0, 1)` | Sheets, drawers |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Exits (faster than entrances) |
| `SPRING_PANEL` | stiffness 420, damping 40, mass 0.5 | Palette/dialog entrance when using Motion |
| `SPRING_LAYOUT` | 360 / 32 / 0.6 | Palette height change between states, selection indicator |
| `SPRING_PRESS` | 500 / 30 / 0.6 | (landing only) |
| `SPRING_MOUSE`, `SPRING_GLIDE` | — | Not used in the app |

| Duration | Value | Use |
|---|---|---|
| `--dur-instant` | 80 ms | Hover/press colour, checkbox tick |
| `--dur-fast` | 120 ms | Menus, popovers, tooltips (in 120 / out 80) |
| `--dur-base` | 180 ms | Dialog, palette, toast (out 120) |
| `--dur-slow` | 240 ms | Sheet/drawer, list re-order |
| Max in app | 300 ms | Nothing longer, ever, in `app/(app)` |

### 10.2 What animates

| Interaction | Animates | How |
|---|---|---|
| Hover/press on controls | colour/background only | CSS `transition-colors` 80 ms; press `translate-y-px` already in button |
| Menus, popovers, tooltips | opacity + 4 px translate/scale 0.98 → 1 | CSS via Base UI `data-starting-style` / `data-ending-style` + `tw-animate-css` |
| Dialog, AlertDialog | opacity + scale 0.98 → 1 | CSS (current `dialog.tsx` uses `zoom-in-95` at 100 ms — change to 0.98 / 180 ms) |
| Command palette open | opacity + scale 0.98 → 1, `SPRING_PANEL`; close 120 ms | Motion (needs coordinated height animation between states) |
| Palette state change (suggestion → pending → done) | container height via `layout`, content cross-fade 120 ms | Motion `layout` + `AnimatePresence mode="popLayout"` |
| Pending bar | indeterminate 1.2 s linear loop (only while pending) | CSS keyframes; reduced motion → static 40 % bar + "Working…" text |
| Task complete | checkbox fill 80 ms, title strike + fade to muted 180 ms, row collapse 240 ms after a 600 ms hold (so Undo is reachable) | CSS for tick/strike; Motion `AnimatePresence` for collapse |
| List insert (new task) | 6 px slide-down + fade 180 ms | Motion `AnimatePresence initial={false}` |
| Toasts | slide from bottom 8 px + fade 180 ms; stack reflow via Base UI toast | CSS |
| Sheet / drawer | translateX 100 % → 0, 240 ms `--ease-drawer` | CSS (Base UI data attributes) |
| Briefing items on first paint | **none** (content must be readable instantly) | — |
| Skeletons | opacity pulse 1.5 s | CSS; reduced motion → static |
| Landing hero/figures | Anatomy figure loops (idle tour), section reveal 8 px + fade 240 ms once | Anatomy's own rAF loop; CSS `@starting-style`/IntersectionObserver for reveals |

Never animate: layout of text the user is reading, focus moving, scroll
position (no smooth-scroll hijack; `scroll-behavior: smooth` only for in-page
anchor links and disabled under reduced motion), anything on page load in the
app.

### 10.3 Motion vs CSS

- **CSS first.** Base UI exposes `data-open`, `data-closed`,
  `data-starting-style`, `data-ending-style`; `tw-animate-css` is already
  imported. All primitive overlays animate with CSS.
- **Motion (`motion/react`, v13.1.1 [VERIFIED])** only where CSS cannot do it
  cleanly: palette height/state morphs, list enter/exit with `AnimatePresence`,
  layout shifts on re-order. Import via `LazyMotion` + `m` with
  `domAnimation` features in `components/motion/provider.tsx` so the full
  bundle is not shipped (target ≤ 20 KB gzip for Motion on app routes
  [ASSUMPTION: typical `domAnimation` size; verify with bundle analyzer]).
- Wrap the app shell in `<MotionConfig reducedMotion="user">`.
- **Never `framer-motion`** (removed, §16).

### 10.4 Reduced motion

When `prefers-reduced-motion: reduce` or `UserPreference.reduceMotion=true`:

- All transforms (translate/scale) become opacity-only at ≤ 80 ms, or no
  transition at all for list re-orders.
- No looping animations: pending bar static, skeleton pulse off, landing
  figures render the static server SVG with no tour (Anatomy kit already stops
  motion under reduced motion [VERIFIED `references/motion.md`]).
- A global CSS guard:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
  }
  ```
  plus `.reduce-motion` class on `<html>` when the user preference overrides the
  system.

### 10.5 Performance rules

- Animate only `opacity` and `transform` (and `clip-path` for the strike).
  No animating `height` with CSS; Motion `layout` uses transforms.
- No `will-change` left on idle elements; no `backdrop-filter` blur in the app
  (removes the hero nav's `backdrop-blur-xl` cost on scroll).
- Animations run only while visible (`IntersectionObserver`); landing figures
  pause offscreen and when the tab is hidden.
- INP budget 200 ms: a click handler must not await an animation before
  updating state; animations follow state.

## 11. Interaction patterns

### 11.1 Command palette states

Each state is visually distinct by **icon + heading text + container
treatment**, never colour alone. All states keep the input at the top; the
body below changes. The body is an `aria-live="polite"` region (errors use
`role="alert"`).

| State | Trigger | Visual | Keyboard | Announced |
|---|---|---|---|---|
| **Suggestion** (idle) | Palette opens | Input placeholder "Type a command, or + to capture"; groups *Recent*, *Suggested from your briefing*, *Go to*; rows: lucide icon 16 px `--subtle-foreground`, label, right-aligned `<kbd>` hints; selected row `--surface-2` + 2 px `--brand` left bar | ↑↓ move, Enter run/navigate, Tab completes suggestion text | — |
| **Pending** | Enter on free text | Input becomes read-only (text kept, `aria-busy`), 2 px indeterminate `--brand` bar under input, body shows `Loader` icon + "Working…" in `--muted-foreground`; after 1.5 s the line updates with server phase text if streamed ("Finding 'the report'…") | Esc closes (command continues, result → toast) | "Working" |
| **Clarification** | `needs_clarification` | Panel with `--brand-subtle` background, `CircleHelp` icon, heading = the question ("Which report?"), options as radio rows numbered 1–5 with title + due + project in `text-body-sm`, last row "None of these — rephrase"; the parts of a multi-intent command that already ran are listed above with ✓ | `1`–`5` or ↑↓ + Enter selects; Esc returns to input with text | Question + option count |
| **Confirmation** | proposal `requires_confirmation` | Bordered card (`--border-strong`, `rounded-lg`), heading icon by risk: `ListChecks` (bulk), `Trash2` in `--danger` (destructive), `Mail` (external draft); a diff list "Expense report: ~~Fri 23 Oct~~ → Mon 26 Oct" (old value `--subtle-foreground` + line-through, new value `--foreground` 500); for drafts, editable To/Subject/Body fields; footer: primary **Confirm** (`--brand`, or `--danger` for destructive) with `<kbd>↵</kbd>` and **Cancel** `<kbd>Esc</kbd>`; footnote "Expires in 15 min" | ⌘↵ / Ctrl+Enter confirms (plain Enter inside a draft body inserts a newline); Esc cancels | "Confirmation needed: 4 changes" |
| **Done** | executed | One line per action: `CircleCheck` in `--success`, verb + object + new value, right side **Undo** ghost button; no background fill; "View" link for created items | `U` or ⌘Z undoes the last line; Enter closes | Each line |
| **Answer** | READ intents | Results list (tasks/emails/events) with source chips; text answers in `text-body`, with *Inferred* badge if summarised | ↑↓ through results, Enter opens | Summary count |
| **Error** | 4xx/5xx/timeout/rate-limit | `--danger-subtle` panel, `CircleX` in `--danger`, specific message (§12), actions **Retry** (same `clientRequestId`) and, where relevant, **Reconnect Google** / **Use quick capture** | Enter retries | `role="alert"` |
| **Offline** | `navigator.onLine=false` | Input disabled, `WifiOff` icon, "You're offline. Quick capture still works (saved when you're back)." | — | — |

The palette never shows a free-floating tooltip as the result (replaces the
`AnimatedTooltip` hack) [GAP].

### 11.2 Voice states

| State | Visual |
|---|---|
| Unsupported | No mic button; input hint "Voice isn't supported in this browser" |
| Idle | `Mic` icon button, `aria-pressed=false`, tooltip "Voice (⌘⇧.)" |
| Requesting permission | Mic button spinner-free; helper text "Allow microphone access to use voice" |
| Listening | Button filled `--brand` with `Mic` in `--brand-foreground`, three-bar level meter (CSS, driven by recognition `onaudiostart/onsoundstart` events; static under reduced motion), "Listening…" label, interim transcript in input in `--muted-foreground` |
| Final | Transcript in input in `--foreground`, fully selected; helper "Press Enter to run, or edit first" |
| Denied / error | `MicOff` icon, inline message with fix steps |

### 11.3 Briefing items: fact vs inference

```
┌ Needs attention ───────────────────────────── Prepared 06:31 ┐
│ ● Finish Q3 report                          [Move] [Remind]  │
│   Due today · High                                            │
│   ▢ Task                                                      │
│ ───────────────────────────────────────────────────────────── │
│ ○ Reply to Jordan Lee   ┆Inferred┆                           │
│   Unread since Tue 17:42; asks for two call times this week. │
│   ✉ Gmail · "Next steps — Staff Engineer role" ↗             │
└───────────────────────────────────────────────────────────────┘
```

- **Fact items:** plain rendering; reason in `text-body-sm` `--muted-foreground`.
- **Inferred items:** a `Badge` variant `inferred` = text "Inferred",
  `--muted-foreground` text, 1 px **dashed** `--border-strong` outline,
  transparent background, `rounded-sm`; tooltip/`aria-describedby`: "Personal
  OS concluded this from the sources below; check before relying on it." The
  reason text is the same colour as facts (it must remain readable).
- Inferred summaries in Answer state use the same badge.
- Source chips are always visible (not on hover): icon + label; clicking
  opens the source (task sheet or Gmail/Calendar in a new tab).
- Live reconciliation: completed-since-briefing items render with title
  line-through + "Done since briefing" meta; moved items show the new date.
- Partial-failure banner sits above the sections: `--warning-subtle`,
  `CircleAlert` `--warning`, "Gmail couldn't be reached at 06:30 — email items
  are missing." [Retry] / [Reconnect Google].

### 11.4 Priority rendering

| Priority | Glyph (lucide) | Colour token | Label (accessible name / tooltip) |
|---|---|---|---|
| URGENT | `ChevronsUp` | `--priority-urgent` | "Urgent priority" |
| HIGH | `ChevronUp` | `--priority-high` | "High priority" |
| MEDIUM | `Equal` | `--priority-medium` | "Medium priority" |
| LOW | `ChevronDown` | `--priority-low` | "Low priority" |
| NONE | none | — | — |

Due-date meta: overdue = `--danger` text + "Overdue · Mon 19 Oct"; today =
`--foreground` 500 "Today"; otherwise `--subtle-foreground`.

### 11.5 Keyboard map (app)

| Key | Action |
|---|---|
| ⌘K / Ctrl+K | Command palette |
| C | Quick capture |
| ⌘⇧. / Ctrl+Shift+. | Voice (inside palette) |
| G then T / I / U / O / A / P / S | Go to Today / Inbox / Upcoming / Overdue / All / Projects / Settings |
| J / K or ↑ / ↓ | Move row cursor |
| X | Select row |
| E or Space | Complete / reopen |
| Enter | Edit title / open |
| D, P, M, H | Date, priority, move to project, snooze ("hold") |
| ⌘Z / Ctrl+Z | Undo last change |
| ? | Shortcut sheet |

Single-key shortcuts are disabled while focus is in an editable field and can
be turned off in Settings (WCAG 2.1.4).

## 12. Empty, loading, error and disconnected states

| Surface | Empty | Loading | Error | Disconnected / partial |
|---|---|---|---|---|
| Today briefing | "Nothing needs you right now." + "Capture something (C)" | Server-rendered; if *preparing*: "Preparing your briefing…" with 3 skeleton rows (static under reduced motion) and the live task list still shown | "Couldn't prepare today's briefing." + Retry; tasks shown below | Google not connected: one inline card "Connect Google to include email and calendar" [Connect]; PARTIAL banner per §11.3 |
| Today tasks | "No tasks due today." + link "See Upcoming" | Rows are server-rendered; no spinner on first load | Inline error row "Couldn't load tasks" + Retry | — |
| Inbox | "Inbox zero. New captures land here." | — | same pattern | — |
| Upcoming | "Nothing scheduled in the next 14 days." | — | — | Calendar busy-time missing: meta "Calendar unavailable" |
| Overdue | "Nothing overdue." (success icon) | — | — | — |
| Completed | "Completed tasks appear here for 30+ days." | pagination skeleton | — | — |
| Search | Before query: recent searches; no results: "No tasks match 'xyz'." + "Create 'xyz'" | inline `Loader` after 300 ms | — | — |
| Agenda rail | "No events today." | 3 skeleton rows | "Calendar couldn't be reached" + Retry | "Reconnect Google" |
| Palette | §11.1 | Pending | Error | Offline |
| Settings → Integrations | "Not connected" card with scopes explanation | — | "Couldn't check status" | "Needs reconnect" with `Unplug` icon, `--warning` |
| Global | — | Route-level `loading.tsx` uses page skeleton matching final layout (no CLS) | `error.tsx`: "Something went wrong" + Reload + error id | Offline top bar: `WifiOff` "You're offline — changes will retry" |

Copy rules: say what happened, what still works, and the one next step. No
"Oops", no exclamation marks, no blame.

## 13. Iconography

- **lucide-react** 1.34.0 [VERIFIED installed], the shadcn icon library
  (`components.json`).
- Sizes: 16 px default in app (`size-4`), 14 px inside chips/meta, 20 px in
  empty states and mobile nav. Stroke width 1.75 globally (set
  `[&_svg]:stroke-[1.75]` on the shell).
- Icons inherit `currentColor`; decorative icons `aria-hidden`; icon-only
  buttons require an accessible name.
- No emoji as UI (removes `🎙️` in the palette and emoji in landing mocks).

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| Today | `Sun` | Reminder | `Bell` |
| Inbox | `Inbox` | Recurrence | `Repeat` |
| Upcoming | `CalendarDays` | Blocked by | `Link2` |
| Overdue | `CalendarClock` | Snooze | `AlarmClock` |
| Completed | `CircleCheck` | Undo | `Undo2` |
| All | `List` | Source: task | `ListTodo` |
| Projects | `Folder` | Source: Gmail | `Mail` |
| Search | `Search` | Source: Calendar | `Calendar` |
| Settings | `Settings` | Source: memory | `BookMarked` |
| Command | `Command` | Source: web | `Globe` |
| Voice | `Mic` / `MicOff` | External link | `ExternalLink` |
| Clarification | `CircleHelp` | Error | `CircleX` |
| Warning/partial | `CircleAlert` | Offline | `WifiOff` |
| Disconnected | `Unplug` | Retry | `RefreshCw` |
| Bulk confirm | `ListChecks` | Delete | `Trash2` |
| Pending | `Loader` (rotates; static under reduced motion) | Add | `Plus` |

## 14. Landing page and Anatomy figures (ADR-014)

### 14.1 What Anatomy is [VERIFIED from `scratchpad/anatomy/src/README.md`, `SKILL.md`, `LICENSE`]

- MIT © 2026 Ryan (`github.com/wheresryan22/anatomy`). A skill + a
  zero-dependency kit ("Apart from React for those components, it has no
  dependencies") that builds **isometric SVG figures** of a real physical
  object whose working *is* the concept ("The object is the explanation"),
  optionally with WebGL layers or a beta 3D mode.
- Figures are solid parts with four-tone shading painted back to front, in a
  framed card ("`Fig n` at top left, a short title at top right, the
  interaction hint at bottom left and the live readout at bottom right"),
  with calm time-based motion that "stops when offscreen, and goes still under
  reduced motion".
- React/Next path: copy `kit/` (`iso-kit.ts`, `iso.css`, `react/draw.tsx`
  server-safe components, `react/live.tsx` client hooks) into the project;
  geometry in plain `.ts` modules; static art built in a **server component**;
  one `"use client"` live component moves things (`references/react.md`).
- Theme: `.iso` wrapper is dark by default; `.iso[data-theme="light"]` is
  light [VERIFIED `kit/iso.css`]. Tokens are `--anatomy-*` (page, paper, card,
  face, lo/mid/hi, lit, mono, blue, green, red…).
- Verification tools: `kit/audit.mjs` (geometry), `scripts/lines.mjs`
  (line-end check), `scripts/capture.mjs` (screenshots incl. 390 px).
- Sizes: a *Figure* is 40–80 parts, SVG with at most one WebGL layer, under an
  hour; a *Hero* 80–150 parts, 2–4 hours.

### 14.2 Figures for Personal OS

Three **Figure**-size, SVG-only figures (no WebGL, no 3D beta — keeps the
landing JS budget and avoids the beta engine). Each maps one product idea to
one machine, following the skill's rule.

| Fig | Section | Concept | Object | What moves | Live readout (from a pure model) |
|---|---|---|---|---|---|
| 1 | Hero | The morning briefing reduces everything to a few things that need you | **A mail-sorting desk**: an intake tray of envelopes (email), index cards (tasks) and tabbed cards (events) feeding a roller past a sorting gate into a short rack of 7 pigeonholes marked "Today" and a deep "Later" bin | Items slide from intake over the roller; the gate flips each into Today or Later; Today slots fill to ≤ 7 | `06:30 · 43 in → 6 need you` |
| 2 | "One command" | A sentence resolves to an exact date, deterministically | **A rotary date stamp** with day/month wheels and a thumb lever, above an index card | Wheels roll from `21 OCT` to `22 OCT`; the stamp presses the card | `"tomorrow" → Thu 22 Oct` |
| 3 | "Nothing risky without you" | Bulk/destructive/external actions need confirmation | **A guarded toggle switch** (flip-up safety cover over a toggle) on a small panel with an indicator lamp | Hover/focus lifts the cover; activating flips the toggle and the lamp lights (`lit` accent) | `4 changes · confirm to apply` |

Each figure's model module encodes only true product rules (≤ 7 attention
items; date resolution example; confirmation classes), per Anatomy's "every
number the figure shows comes from the same small model".

### 14.3 Integration

```
components/landing/figures/
  LICENSE                 MIT notice copied verbatim from anatomy/LICENSE
  NOTICE.md               "Figures built with the Anatomy kit (MIT), github.com/wheresryan22/anatomy, version <commit>"
  kit/                    iso-kit.ts, iso.css, react/draw.tsx, react/live.tsx (vendored, unmodified)
  iso-theme.css           maps --anatomy-* to app tokens (below)
  sorter/  model.ts view.ts geometry.ts art.tsx live.tsx figure.tsx
  stamp/   …
  guard/   …
```

- `figure.tsx` (server) renders the `Plate` with static art: the full figure
  at rest is **in the server HTML** — it is the LCP-safe image, the no-JS view
  and the reduced-motion view.
- `live.tsx` (client) is loaded with `next/dynamic(() => import('./live'), { ssr: false })`
  only when the plate scrolls within 200 px of the viewport (the hero figure is
  in view, so it loads after `requestIdleCallback`). It animates via refs (no
  React re-render per frame), pauses offscreen (`useInView`) and on
  `document.hidden`, and does nothing under reduced motion (`useStillness`).
- Budget: all three live chunks + kit runtime ≤ 60 KB gzip total; the static
  SVG markup per figure ≤ 120 KB uncompressed (keep part counts in the Figure
  tier). Measured with `@next/bundle-analyzer` in CI.
- Theme adapter (`iso-theme.css`): the app uses `.dark` on `<html>`, Anatomy
  uses `.iso` (dark) / `.iso[data-theme="light"]`. The adapter copies the
  kit's light-theme token block to `html:not(.dark) .iso` so server HTML is
  correct in both themes without client attribute writes, and sets
  `--anatomy-mono: var(--font-mono)`, `--anatomy-page: var(--background)`,
  `--anatomy-card: var(--surface)`, `--anatomy-blue: var(--brand)`. Figure
  tokens stay scoped to `.iso`, never `:root` (as `references/react.md`
  requires).
- Accessibility: each plate is a `<figure>` with the SVG `role="img"` and an
  `aria-label` describing the mechanism and its meaning; a visible
  `<figcaption>` carries the true caption; interactive figures are reachable by
  keyboard (Tab focuses the plate, arrow keys drive the same control as hover)
  and the readout is `aria-live="polite"` only while the figure is focused.
- Verification before merge: `node build --audit` equivalent for any pipes
  (none planned), `scripts/lines.mjs` must print `line ends: 0`, captures at
  1440 px and 390 px in both themes, reduced-motion capture static.
- Generated with the skill from the repo-local copy at
  `scratchpad/anatomy/src` during implementation; the skill itself is not a
  runtime or dev dependency.

### 14.4 What to keep from the existing landing [VERIFIED `components/hero/*`]

| Keep | Change |
|---|---|
| Section order: nav → hero → features → how it works → FAQ (+ add `footer.tsx`, which exists but is not rendered) | Nav links: plain text links (remove `RandomLetterSwap`); "Sign in" → `/sign-in`, "Get started" → `/sign-up` (currently both point to `/api/auth/signin`, the Auth.js route being deleted per ADR-002) [GAP] |
| Headline idea "Your day, managed by one command" | Remove violet→indigo gradient text, radial-gradient glow and the "AI-Powered Productivity" sparkles badge; H1 in `text-display`, `--foreground`; one primary CTA (brand) + one secondary |
| `CommandBarDemo` typing demo in `features-section.tsx` | Type the real product sentence ("Move the thing I need to finish today to tomorrow and remind me about the recruiter email after lunch") and show the real Done lines; respect reduced motion (show final text immediately) |
| Mini mocks of schedule and email lists | Rebuild with app tokens and real components (task row, source chips, Inferred badge) so the landing previews the product truthfully; replace emoji with lucide icons |
| Bento layout of feature cards | Radius 8 px max (currently `rounded-[28px]`), tinted backgrounds (`bg-violet-50/60`, `bg-blue-50/60`…) replaced with `--surface` + `--border`; colour only via the figures |
| FAQ content structure | Rebuild on Base UI Accordion; correct claims: remove "Google Tasks" support, "reschedule meetings", "Evening Wrap-up", and the premium-tier answer (non-goals in `00` §8); add "Does it send email? No — it only saves drafts for you to review." |

## 15. Accessibility checklist (WCAG 2.2 AA)

- [ ] Colour pairs measured per §5.2; new pairs added to the table.
- [ ] Information not by colour alone (priority glyph + label; status icons;
      Inferred text badge; overdue text "Overdue").
- [ ] Focus visible on every interactive element: 2 px `--ring` outline with
      2 px offset, ≥ 3:1 against adjacent colours; never removed.
- [ ] Focus not obscured by sticky topbar, toasts or the mobile command button
      (2.4.11): `scroll-padding-top: var(--topbar-h)`; toasts never cover the
      focused element.
- [ ] Target size ≥ 24×24 (2.5.8): icon buttons, checkboxes (hit area),
      chips with actions.
- [ ] Dragging alternatives (2.5.7): every drag has a menu/keyboard path.
- [ ] Keyboard: full app usable without a pointer; palette is a combobox with
      `aria-activedescendant` (cmdk); dialogs trap focus and restore it on
      close (Base UI); roving tabindex in lists.
- [ ] Character-key shortcuts can be turned off (2.1.4).
- [ ] Live regions: palette body polite; errors assertive; toasts announced
      once; voice listening state announced.
- [ ] Forms: visible labels, errors linked with `aria-describedby`, inputs
      with `autocomplete` (`email`, `current-password`, `new-password`,
      `one-time-code`); paste allowed (3.3.8).
- [ ] Headings: one `h1` per page; sections `h2`; briefing items are list
      items with the title as the accessible name.
- [ ] Reduced motion honoured (§10.4); no flashing > 3 Hz.
- [ ] Text resize to 200 % and reflow at 320 px without horizontal scrolling
      (except data tables, none in V1).
- [ ] Dark and light themes both pass axe-core with zero serious/critical
      issues (Playwright + `@axe-core/playwright` on every route).
- [ ] Screen-reader pass (VoiceOver/Safari, NVDA/Chrome) of the 8 AM scenario.
- [ ] Landing figures have text alternatives and captions.

## 16. Dependencies

[VERIFIED current versions from `package.json` / `node_modules`]

| Action | Package | Reason |
|---|---|---|
| **Remove** | `framer-motion` ^13.1.1 | Duplicate of `motion` ^13.1.1 (ADR-013). Only importers: `components/ui/animated-tooltip.tsx`, `components/hero/streak-widget.tsx` — both removed. Add an ESLint `no-restricted-imports` for `framer-motion`. |
| **Remove** | `lottie-web` ^5.13.0 + `public/lottie/*.json` | 76.6 KB gzip player + 472 KB JSON; replaced by Anatomy figures (ADR-014). |
| **Remove** (with ADR-002) | `next-auth`, `@auth/drizzle-adapter`, `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless` (if unused after ADR-003) | Legacy stack; listed here because `app/(app)/layout.tsx` (UI) still imports `@/auth`. |
| **Remove** | `components/ui/random-letter-swap.tsx`, `m-random-letter-swap-1.tsx`, `animated-tooltip.tsx`, `section-separator.tsx`, `stat-card.tsx`, `components/hero/streak-widget.tsx`, `components/motion/command-palette.tsx` (after porting), unused `public/*` files | Unused or replaced (§3). |
| **Keep** | `motion` ^13.1.1 | The one animation library; `LazyMotion` + `m`. |
| **Keep** | `@base-ui/react` ^1.7.0, `cmdk` ^1.1.1, `lucide-react` ^1.34.0, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css` | Foundation (ADR-013). |
| **Keep (MAY move to devDependencies)** | `shadcn` ^4.19.0 | It is the CLI, but `app/globals.css` imports `shadcn/tailwind.css`, so the package must be installed at build time. |
| **Add** | `react-day-picker` (v9, MIT) | Calendar grid inside the date field popover; the same library shadcn's Calendar uses. [ASSUMPTION: v9 supports React 19 — verify peer range at install.] Lazy-loaded inside the popover. |
| **Add** | `chrono-node` | Deterministic date parsing for quick capture preview and server resolution (ADR-008); shared parser so the date field preview matches what the server will resolve. |
| **Add (dev)** | `@playwright/test`, `@axe-core/playwright` | E2E for the 8 AM test and accessibility gates. |
| **Add (dev)** | `@next/bundle-analyzer` | Enforce JS budgets (`00` §6.1). |
| **Do not add** | `next-themes`, `sonner`, `@radix-ui/*`, `react-aria-components`, `gsap`, `three` | Theme script is 600 bytes inline; Base UI has Toast; second primitive layer forbidden (ADR-013); figures are SVG. |

## 17. Responsive breakpoints

Tailwind 4 defaults (rem-based so they scale with user font size).

| Breakpoint | Min width | Layout |
|---|---|---|
| base | 0 | Single column; sidebar in Drawer; topbar 48 px; bottom command button; task sheet full-screen; palette full-width at top with 8 px margins; agenda rail stacked below briefing |
| `sm` | 40rem (640) | Palette centred `--palette-w`; dialogs centred |
| `md` | 48rem (768) | Sidebar collapsed rail (56 px, icons + tooltips) |
| `lg` | 64rem (1024) | Full sidebar 240 px; task sheet overlays from right (modal) |
| `xl` | 80rem (1280) | Today shows agenda rail (320 px); task sheet becomes a non-modal side panel pushing content |
| `2xl` | 96rem (1536) | Content stays at `--content-max`; extra space becomes margin |

Landing: hero figure stacks below the headline under `lg`; figures must read at
390 px (Anatomy composition rule).

## 18. Implementation order (UI)

1. Tokens + theme script in `app/globals.css` / `app/layout.tsx`; ESLint
   colour/radius rule; remove `framer-motion`, Lottie, unused components.
2. App shell in `app/(app)/layout.tsx` with `getSession()`, sidebar, topbar,
   providers (Motion, toast, palette, quick capture).
3. Primitive additions (§9) via `pnpm dlx shadcn@latest add` with the
   `base-nova` style, then token review.
4. Command palette rewrite with all §11.1 states (Storybook-free: a
   `/dev/palette-states` route behind `NODE_ENV !== 'production'` renders each
   state with fixtures for visual and axe checks).
5. Task row/list/sheet; briefing components; agenda rail; empty/error states.
6. Landing rebuild with Anatomy figures; copy corrections.
