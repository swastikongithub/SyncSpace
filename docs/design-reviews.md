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
