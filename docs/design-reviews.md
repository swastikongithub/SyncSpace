# Design reviews

Reviews of the built interface, from screenshots captured with Playwright (desktop 1440×900, Pixel 7 phone) against seeded demo data. Each finding lists what changed.

## Review 1: first build (2026-10-12)

**Method:** a scripted session with two signed-in people editing the same document, one going offline, history opened, members page, and a viewer on a phone. Screens were reviewed against [design.md](design.md), then with the design plugin's `design:design-critique` framework (usability, hierarchy, consistency, accessibility). Automated checks: axe (WCAG 2.2 AA tags) on six screens in the end-to-end suite, and measured colour contrast.

### What works

- **Sync state has a shape and words that agree.** Offline, the header reads "Saved on this device only", the device plate in the registration mark slips out of register, the copies panel gives an exact unsent count, and the edited paragraphs carry a carbon wet-ink rule. All four come from the same engine state.
- **The sheet dominates.** The document title (Literata at display size) and body text draw the eye first; status and tools sit on the desk around it.
- **Presence is identity, not decoration.** Ply-coloured carets with names, and the copies panel lists who is here and whether they have edits on the way.
- **Viewer state is explicit** on desktop and phone ("You're a viewer…", status "Up to date", no toolbar).

### Findings and changes

| # | Finding | Severity | Change |
|---|---|---|---|
| 1 | Document list excerpts ran headings into prose ("…short. The first law Energy is conserved…") | Moderate | Excerpts skip headings and end each block as a sentence; headings stay searchable |
| 2 | After scrolling, the side panel's heading slid under the sticky document bar, because the toolbar row wasn't included in the offset | Moderate | Panel offset follows the bar's real height with or without the toolbar (measured: panel top 154.9 px, bar bottom 154 px) |
| 3 | Opening a version while scrolled left its banner (Restore / Back to current) off-screen | Moderate | The version scrolls into view and focus moves to its heading |
| 4 | "Remove" on the members page removed a person immediately | Moderate | Confirmation dialog naming the person and the consequence |
| 5 | "Leave this workspace…" was styled like a neutral action, and a sole owner was offered a button the server would refuse | Minor | Destructive styling; sole owners see why they can't leave |
| 6 | On phones the formatting row was cut off mid-icon with no hint of more tools | Minor | Fading right edge plus end padding on narrow screens (the row is 701 px of tools in a 412 px viewport, measured) |
| 7 | Long titles were truncated in the document tray with no way to read them | Minor | Full title on hover and focus |
| 8 | "Take ana's phone offline" in the sign-in explainer (lower-cased name) | Minor | Explicit labels |

### Accessibility checks

- axe (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`): **no serious or critical violations** on sign-in, onboarding, empty workspace, document, document with history, and members (e2e/accessibility.spec.js).
- Contrast: all measured text pairs pass AA; body text is 16.3 : 1 (light) and 14.3 : 1 (dark). See design.md §7.
- Keyboard: dialogs use native `<dialog>` (focus trap, Escape), menus support arrow keys, Home/End and Escape, and every icon-only control has an accessible name.
- Target sizes: toolbar buttons are 40 px, quiet buttons 36 px. That meets WCAG 2.2 AA (24 px); the AAA 44 px level is not met for toolbar buttons.
- Phone: no horizontal page scrolling on any tested screen (asserted in e2e/mobile.spec.js).

## Review 2: the landing page (2026-10-14)

**Method:** Playwright screenshots of every chapter at 1440×900 and on a Pixel 7, in light and dark schemes, on three renderers: WebGPU (Chromium with an NVIDIA adapter), the WebGL 2 fallback (headless Chromium) and the SVG poster (3D APIs removed). Close-ups were taken at 2× to judge the halftone and moiré. Reviewed against [landing-page-design.md](landing-page-design.md) with the `design:design-critique` framework, plus axe in the e2e suite.

### What works

- **The idea reads without the text.** In register, four tinted plies print as one page with crisp registration targets. Out of register, your copy's rows and targets visibly double, and moiré appears where its screen crosses the others.
- **The demo and the stage agree.** Typing offline in the live Yjs demo lifts the laptop's sheet and wets exactly the rows the server lacks; reconnecting brings every copy back into register (176 identical characters in all three replicas in the test run).
- **Dark mode turns the pad into a lamp:** the glass glows and its light spills onto the desk.

### Findings and changes

| # | Finding | Severity | Change |
|---|---|---|---|
| 1 | With a thick dark frame, the light table read as a tablet screen | Moderate | Thin aluminium bezel, visible slab thickness, and the pad's light spilling onto the desk |
| 2 | The pad's light ended in a hard rectangle at the canvas edge | Moderate | The canvas fades into the desk at every edge (CSS mask) |
| 3 | In register, four multiplied inks made the text rows heavy black bars, and the tint screens muddied the sheets | Moderate | Smaller dots (radius 0.38 of a cell), lighter tint screens, a softer ink for the server's film |
| 4 | History's version proofs floated above the pad and vanished against the dark desk | Moderate | Earlier versions slide out beside the current copy as smaller proofs on the glass |
| 5 | The first droplet spray was a dense smear | Minor | Smaller, translucent droplets that spread wider, arc between sheets and split into two plumes for the two receiving copies |
| 6 | "How a keystroke becomes stored" put each word of a step on its own line | Critical | Each step's text is one block beside its number |
| 7 | On phones the stage band was two-fifths of the screen with a three-line caption | Moderate | Tighter framing on the sheets, a shorter band, and the caption kept for screen readers (the chapter text below repeats it) |
| 8 | The SVG fallback's table was oversized, with a heavy frame, and its note overlapped the caption | Minor | Pad proportions and bezel match the 3D one; the note has its own row |
| 9 | With a Spline scene, the devices section still called it "screenshots" | Minor | The sentence appears only when screenshots are shown |

### Accessibility checks

- axe (WCAG 2.2 AA tags) on the landing page: **no serious or critical violations** (e2e/landing.spec.js).
- No horizontal overflow at 320, 360 and 412 px wide (e2e/landing-mobile.spec.js).
- Reduced motion: no headline animation, no opening sequence, state changes drawn in at most a few frames (asserted).
- Every stage interaction has an HTML equivalent; the canvas is hidden from assistive technology, and its figure caption describes what it shows.
