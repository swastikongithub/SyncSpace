# SyncSpace design direction

This records how SyncSpace's interface was derived, what was rejected, and why. No external products, screenshots or templates were used as references.

## 1. What the interface has to do

SyncSpace is a place to write documents with other people, on devices that drop off the network. Its users are individuals, small teams and study groups, often on laptops and phones with unreliable connections.

The core promise is technical: *your words converge and persist*. The core anxiety follows from it: **"is what I just typed safe, and does everyone else have it?"** Most writing tools answer with a cloud icon that is either a spinner or a tick. SyncSpace can say more, because the sync engine knows three exact facts at every moment:

1. what is saved **on this device** (IndexedDB write confirmed);
2. what is **stored on the server** (the server's durability Ack, sent only after MongoDB has the change);
3. who else is **here now**, and whether *they* have unsent changes (from presence).

The design job is to make those three facts legible without getting in the way of writing.

## 2. Concepts considered

| Concept | Idea | Strength | Weakness | Verdict |
|---|---|---|---|---|
| **A. Carbon copies / registration** | Every replica is a sheet in a carbon-copy set. When the copies agree, the sheets are *in register*, aligned like a printed page. When this device holds changes the server lacks, its sheet visibly slips out of register. Unsent text is "wet ink" that dries when the server stores it. | Maps one-to-one onto the real model (replicas, divergence, convergence). Gives the status a shape, not just a colour. Quiet while writing. | Must never become skeuomorphic decoration; every visual needs a plain-language label. | **Chosen** |
| B. Transit / switchboard | Documents as stations, updates as trains, offline as "service suspended". | Strong wayfinding vocabulary. | Movement metaphors fit transport, not writing; busy; the gimmick would wear thin. | Rejected |
| C. Field notebook | Documents as notebooks, sync as filing to an archive. | Fits offline fieldwork. | Pulls toward textured paper, cream and serif: a stock "writing app" look. Says little about *agreement* between copies. | Rejected |

Concept A also supplies a natural, period-true palette. Multi-part forms come in tinted plies (white, canary, pink, blue, green), and those plies become collaborators' identity colours.

## 3. Token plan (frontend-design pass 1)

**Colour.** Six named roles. Every pair was contrast-checked (results below).

| Name | Light | Dark | Role |
|---|---|---|---|
| Desk | `#E6E4EC` | `#14121C` | The surface around documents: a lilac-grey blotter, not cream, not slate |
| Sheet | `#FFFFFF` | `#1D1A28` | The document itself; the only bright surface |
| Ink | `#211D33` | `#ECE9F6` | Text: blue-black writing ink |
| Graphite | `#5A5670` | `#A7A2BD` | Secondary text |
| Carbon | `#4B3FC4` | `#A79BFF` | Carbon-copy violet: actions, focus, links, and the "wet ink" of unsent changes |
| Correction | `#B42318` | `#FF8A80` | Proofreader's red pencil: errors and destructive actions only |

**Plies** (people): canary, rose, sky, mint, lilac, apricot, teal, pewter. Each has a pale tint for chips and a deep tone (≥ 5:1 on the sheet) for cursors and name labels. Colour is never the only identifier: names are always shown.

**Type.**

- **Literata** (variable, with optical sizes) for everything a person *writes*: document titles and body. It was drawn for long reading on screens, and its optical-size axis lets the same family serve 17 px body and 44 px titles.
- **Atkinson Hyperlegible Next** (variable) for everything the *interface* says. It was designed for low-vision legibility, which suits a product whose status messages must be read correctly at a glance.
- Two clearly distinct families: serif = your words, sans = the system talking. No monospace UI labels; code blocks use the system monospace stack.

**Layout concepts compared (ASCII).**

```
Option 1, centred sheet with a "copies" rail (chosen for desktop)
┌───────────────────────────────────────────────────────────────────┐
│ ▣ SyncSpace  Physics group ▾                         Search  ⌘K   │
├────────────┬──────────────────────────────────────┬───────────────┤
│ Documents  │      ┌─────────────────────────┐     │ Copies        │
│  Thermo    │      │ Thermodynamics notes    │     │ ▮ This device │
│  Entropy   │     ▌│ The first law…          │     │ ▮ Server      │
│  + New     │      │                         │     │ ▮ Ana         │
│            │      └─────────────────────────┘     │ History       │
└────────────┴──────────────────────────────────────┴───────────────┘

Option 2, full-bleed editor with status in a footer bar (rejected)
  The status becomes a strip of small text nobody reads, and nothing in it
  says whose copy is where.

Option 3, editor with a floating status pill (rejected)
  It hides exactly the information that matters when it matters, and
  obscures text on small screens.
```

Alignment: document text is left-aligned with a fixed measure (≈ 68 characters). Interface text is left-aligned; nothing is centred except empty states.

**Principles.**

1. *Status has a shape.* Agreement is shown as alignment, divergence as offset, and it is always paired with words.
2. *The sheet is sacred.* Nothing overlaps the writing surface. Chrome lives on the desk.
3. *Say exactly what is true.* "Stored on server" means the server acknowledged it. "On this device" means IndexedDB confirmed the write. No optimistic ticks.
4. *One moment of motion.* Copies slide back into register when a sync completes. Nothing else animates on its own.

## 4. Review against generic defaults (frontend-design pass 2)

| Plan element | Risk of being a default? | Change made |
|---|---|---|
| Serif body on a light page | Close to the "cream + serif + terracotta" cluster | Kept the serif (it earns its place for long reading) but the page is white on a **lilac-grey** desk, and the accent is **carbon violet**, not clay. The serif is used only for user content. |
| Left document sidebar | Generic SaaS shell | Kept, because navigation between documents is a real task. Restyled as a **tray of sheet edges**, and it collapses away on narrow screens. Status lives in the copies rail, not the sidebar. |
| Status as an icon in the header | The universal cloud-tick default | Replaced with the **registration mark**: two offset squares that come into alignment, plus a text label. It opens the full copies panel. |
| Coloured avatar circles for people | Default presence pattern | People are **plies**: a tinted sheet-edge chip with the name. Cursors use the ply's deep tone. |
| Card grid for the workspace home | The SaaS-card kit | A **single-column index of sheets**: title, first line, who edited it last and when, and whether a copy is on this device. Lists scan faster than grids for text documents. |
| Fade-up entrance animations | Generated-page tell | None. The only autonomous motion is the registration snap. |
| ALL-CAPS section labels, `A · B · C` metadata, `→` on buttons | Template chrome | Sentence-case labels; metadata written as sentences ("Edited by Ana 4 minutes ago"); buttons say what they do. |

## 5. Interaction model

- **The copies rail** (desktop: right column; mobile: a sheet opened from the header mark) lists *This device*, *Server*, and each collaborator present, each with a precise state:

  | Replica | States |
  |---|---|
  | This device | Saved on this device · Saving… · Not kept on this device · Couldn't save on this device |
  | Server | Has all your changes · Missing *n* of your changes · Not reachable · Signed out · No access |
  | Collaborator | Editing · Has unsent changes (from their presence) |

- **Wet ink.** Paragraphs edited since the server last confirmed get a carbon mark in the margin. The mark clears per paragraph as acknowledgements arrive. Offline, the marks show exactly which paragraphs exist only here.
- **Offline is not an error.** The banner is informational ("Offline. Your edits are saved on this device and will sync when you reconnect."). Editing is never blocked for documents that are on the device. Documents not on the device say so plainly.
- **Restores and recoveries are announced**, with who did them and how to undo (restore the "Before restoring…" version).
- **Keyboard:** ⌘/Ctrl-K search, ⌘/Ctrl-S shows status (there is nothing to save manually), Escape closes panels. Every control is reachable by Tab, with a visible 2 px carbon focus ring.

## 6. Motion and reduced motion

The registration snap (≈ 240 ms ease-out) and the drying of wet-ink marks (≈ 300 ms) are the only non-user-triggered motion. Panels open in 150 ms. With `prefers-reduced-motion: reduce`, every transition is instant and the state is shown in its final position.

## 7. Contrast verification

Measured with the WCAG 2.x relative-luminance formula (script in the development log):

- Ink on sheet: 16.3 : 1 (light), 14.3 : 1 (dark). Graphite on desk: 5.6 : 1 / 7.5 : 1.
- Carbon text on sheet: 7.5 : 1 / 7.1 : 1. Button text on carbon: 7.5 : 1 / 7.8 : 1.
- Wet-ink mark (non-text UI) on sheet: 4.0 : 1 (≥ 3 : 1 required).
- All eight ply deep tones on the sheet: 5.3–7.8 : 1 (light), 8.1–11.2 : 1 (dark).
- Correction red: 6.6 : 1 / 7.5 : 1.

## 8. Advanced graphics: Three.js, React Three Fiber, WebGPU, Spline

See [ADR 0005](adr/0005-advanced-graphics.md) for the measured evaluation. Summary: the concept *is* spatial (layered sheets), but every spatial element SyncSpace needs is a handful of offset planes carrying real, selectable, screen-reader-visible text. CSS 3D transforms and SVG do that at zero bundle cost. A measured R3F prototype of the same scene cost +233 KB gzip (WebGL) or +422 KB gzip (WebGPU) for no user-visible gain, so none of the four technologies ships in the product.
