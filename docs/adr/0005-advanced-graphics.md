# ADR 0005: Advanced graphics (Three.js, React Three Fiber, WebGPU, Spline)

- Status: accepted; amended for the public landing page by [ADR 0007](0007-landing-page-graphics.md), and for the sign-in pages, which now draw their illustration with one dependency-free WebGL 2 shader ([design.md §9](../design.md#9-sign-in-pages)). The app's own screens are unchanged.
- Date: 2026-10-12

## Context

The specification asks for a deliberate evaluation of Three.js, React Three Fiber (R3F), WebGPU and Spline. Any use must serve a product purpose (orientation, explaining sync, a meaningful interaction), must never interfere with editing, and must degrade gracefully.

SyncSpace's chosen identity ([design.md](../design.md)) is spatial: replicas are sheets in a carbon-copy set, aligned when they agree, offset when they diverge. That makes 3D a fair question rather than a box to tick. The candidate placements were:

1. **The copies rail and header mark**: live status for this device, the server, and collaborators.
2. **The sign-in explainer**: three small sheets running *real* Yjs replicas. The visitor types, takes a "laptop" offline, keeps typing, reconnects, and watches the copies merge.
3. **Version history as a stack of sheets in depth.**

## What each placement actually needs

- A few (3–50) flat rectangles with offsets and a short transition.
- **Real text on them.** In the explainer and history, the text *is* the content; it must be selectable, readable at any zoom, and announced by screen readers.
- To work offline (a precached app shell), under a strict `script-src 'self'` CSP, on low-end phones, and with `prefers-reduced-motion`.

## Measurements

A throwaway prototype rendered the same "three tinted sheets" scene four ways. It was built with Vite 8 in production mode; JS size is gzip-compressed. The prototype lived in a scratch directory and is not part of the repository.

| Variant | JS (gzip) | Cost over a React-only page |
|---|---|---|
| React only, DOM sheets (baseline) | 66.3 KB | — |
| Plain Three.js, no React (3 lit planes) | 126.7 KB | n/a (no React) |
| R3F + Three.js WebGLRenderer | 299.0 KB | **+232.7 KB** |
| R3F + Three.js WebGPURenderer (`three/webgpu`) | 487.9 KB | **+421.6 KB** |

R3F pulls in the full `three` namespace for its JSX catalogue, so unused modules are not tree-shaken. That explains most of the WebGL figure.

## Evaluation

| Technology | Where it could help | What it would cost | Decision |
|---|---|---|---|
| **Three.js** | Lit, translucent paper sheets in the explainer or history | +60 KB gzip minimum (more with text). Text must become textures or SDF glyphs, which are not selectable, so a parallel DOM copy is needed for accessibility anyway. GPU context per view; context loss handling. | **Not used.** The visual gain is lighting and translucency, which is decoration. CSS 3D transforms give the same layering with real text. |
| **React Three Fiber** | Idiomatic React integration if Three.js were used | +233 KB gzip measured; another render loop to manage beside ProseMirror | **Not used**, because Three.js isn't. |
| **WebGPU** | Faster rendering of large scenes | +422 KB gzip measured with R3F; async init; still needs a WebGL fallback. The scene is 3–50 quads, so there is nothing for WebGPU to speed up. | **Not used.** No measurable benefit at this scale. |
| **Spline** | Authoring an original scene visually | A proprietary runtime and editor. Scenes are hosted on Spline's CDN unless self-hosted, which breaks offline-first and the `'self'` CSP. Poor accessibility of embedded scenes. An original scene cannot be authored from this environment without the GUI editor. | **Not used.** |

## Decision

None of the four technologies ships. The spatial ideas are built with **CSS 3D transforms and SVG over real DOM text**:

- The copies rail and the header registration mark are SVG/CSS. Offsets encode state, and a text label always accompanies them.
- The sign-in explainer runs three real Y.Docs with real `<textarea>`s; the sheets are DOM elements with CSS transforms. *(Since moved to the landing page; the sign-in pages now show a shader-drawn light table, see the status line.)*

## Consequences

- No GPU context or render loop competes with typing or text selection.
- Zero bundle cost for the visual identity. Everything works from the precached offline shell and under the strict CSP.
- Reduced motion is a single CSS media query; screen readers see the same text sighted users do.
- If a future feature needs real 3D (e.g. a large spatial map of many workspaces), re-evaluate with R3F, lazy-loaded behind a route, using `three/webgpu` with its automatic WebGL2 fallback, `frameloop="demand"`, and a DOM fallback. These measurements are the starting point.
