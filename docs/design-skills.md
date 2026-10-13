# Design skills: installation record and how SyncSpace uses them

Recorded 2026-10-12 on the development machine (Windows 11, Claude Code 2.1.296, Node 22.13.1, Python 3.12.1).

## Installation status

| Capability | Source | Command run | Result | Where it lives |
|---|---|---|---|---|
| Design plugin | `anthropics/knowledge-work-plugins` | `claude plugin marketplace add anthropics/knowledge-work-plugins` then `claude plugin install design@knowledge-work-plugins` (the non-interactive CLI equivalents of `/plugin marketplace add …` and `/plugin install …`) | ✔ Marketplace added; `design@knowledge-work-plugins` v1.2.0 installed, user scope, enabled (`claude plugin list`) | `~/.claude/plugins/cache/knowledge-work-plugins/design/1.2.0` |
| frontend-design skill | `anthropics/skills` | `npx skills add anthropics/skills@frontend-design -a claude-code -y --copy` | ✔ Installed at project scope (`skills-lock.json` records hash `106acf23…`) | `.claude/skills/frontend-design/` |
| UI/UX Pro Max skill | `nextlevelbuilder/ui-ux-pro-max-skill` | `npx skills add nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max -a claude-code -y --copy` | ✖ **Project-scope install was blocked** by Claude Code's auto-mode permission classifier (third-party code integration). Not bypassed. | The same skill from the same source was already installed at **user scope** on 2026-09-24 (`~/.agents/.skill-lock.json`, hash `d2b30f83…`), so it is available and was used. |

Flags: `-a claude-code -y` makes the `skills` CLI non-interactive (it otherwise prompts for target agents); `--copy` avoids symlinks, which need elevated rights on Windows.

### Conflicts and notes

- **Duplicate design plugin.** A `design` plugin was already synced from claude.ai (same version, 1.2.0). After installation, `claude plugin list` reports: *"design@synced" from claude.ai not loaded — "design@knowledge-work-plugins" on this machine has the same name and takes precedence.* There is no functional conflict; the local install wins.
- **Duplicate frontend-design.** A user-scope copy exists in `~/.claude/skills/frontend-design` (older hash `d79e2a5b…`). The project-scope copy is the one pinned in `skills-lock.json`.
- **To complete the blocked step yourself** (optional, only adds a project-pinned copy): `! npx skills add nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max -a claude-code -y --copy`.
- The design plugin's `.mcp.json` declares optional connectors (Figma, Linear, Notion, …). None are authenticated and none are needed; every command works standalone.
- Skills are documentation and scripts for the agent. None of them add runtime code to SyncSpace, and no TypeScript entered the repository through them (`npm run check:js-only`).

## What each capability is for

**Design plugin (`design@knowledge-work-plugins`).** Workflow skills invoked as `design:<name>`: `design-critique` (usability, hierarchy and consistency review of a screen), `accessibility-review` (WCAG 2.1 AA audit: contrast, keyboard, touch targets, screen readers), `ux-copy` (microcopy, errors, empty states), `design-system` (audit or extend tokens and components), `design-handoff`, `user-research`, `research-synthesis`. They are review lenses, not generators.

**frontend-design.** Guidance for an opinionated, non-templated visual identity. Its required process: write a compact token plan (4–6 named colours, type roles, ASCII layout concepts, principles), review that plan against the brief for generic defaults *before* coding, then build and self-critique with screenshots. It lists the current tells of generated design (cream + terracotta + serif, near-black + acid accent, SaaS card kits, ALL-CAPS eyebrows, `A · B · C` meta strings, monospace data labels, `→` on buttons).

**UI/UX Pro Max.** A local, searchable rule database run as `python ~/.claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>` (or `--design-system`, or `--stack react|html-tailwind|threejs`). Its value is the prioritised UX rule set: accessibility, touch targets, forms, navigation, motion, and a pre-delivery checklist.

## How they complement each other, and the guardrail

- **frontend-design sets the process** for identity: plan, then challenge the plan against generic defaults, then build.
- **UI/UX Pro Max supplies the floor**: concrete, checkable rules (contrast ≥ 4.5:1, 44 px targets, visible labels, reduced motion, no horizontal scroll at 375 px).
- **The design plugin supplies the reviews**: `design:design-critique` and `design:accessibility-review` on real screenshots, and `design:ux-copy` for status, error and empty-state language. These matter most for SyncSpace because its sync vocabulary has to be honest.

**Guardrail: the skills inform; they do not choose the aesthetic.** For example, `search.py "collaborative document editor offline" --design-system` returned a generic result: a "Hero + Features + CTA" landing pattern, slate/blue "Minimalism", Outfit + Work Sans, and scroll-reveal motion. That is the template look the brief rejects, and it ignores SyncSpace's real problem (making replica state legible). It was **not adopted**. Only its checklist items were kept. The identity comes from first-principles reasoning recorded in [`docs/design.md`](design.md).

## Where they are applied in the build

| Stage | Capability | Use |
|---|---|---|
| Design direction | frontend-design | Token plan → generic-default review → revisions, recorded in `docs/design.md` |
| Rules floor | UI/UX Pro Max | Targeted `--domain ux` queries (status messages, form errors, focus, reduced motion); `--stack react` / `html-tailwind` for implementation |
| Copy | design:ux-copy | Sync-status vocabulary, offline and error messages, empty states |
| Verification | design:design-critique, design:accessibility-review | Screenshot reviews of the key screens; findings and fixes logged in `docs/design.md` |
| Landing page (2026-10-14) | frontend-design | Five directions compared, token plan and ASCII layouts, then a pass against generic defaults (sticky scrollytelling, serif hero, card grids, mockup frames); recorded in `docs/landing-page-design.md` |
| Landing page | UI/UX Pro Max | `--stack threejs` and `--domain ux` rules applied: live `prefers-reduced-motion` listener, an accessible description for the canvas, antialias set at construction, no scroll-jacking, at most one or two animated elements per view |
| Landing page | design:design-critique, design:accessibility-review | Screenshot reviews at desktop and phone sizes, light and dark, WebGPU, WebGL 2 and the SVG fallback; findings in `docs/design-reviews.md` (Review 2); axe in the e2e suite |
