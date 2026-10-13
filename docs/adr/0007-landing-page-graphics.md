# ADR 0007: 3D graphics on the landing page

- Status: accepted
- Date: 2026-10-14
- Amends: [ADR 0005](0005-advanced-graphics.md), for the public landing page only

## Context

ADR 0005 kept Three.js, React Three Fiber, WebGPU and Spline out of the product: the app's spatial ideas need a few flat sheets carrying real, selectable text, and CSS transforms do that at no cost.

The landing page is a different job. It has to explain, in seconds and to people who have not used the product, what a CRDT-backed offline-first editor does: copies diverge, then merge, and nothing is stored until the server says so. A visual that *simulates* that, driven by the same state model as the text beside it (including a live Yjs demo), is worth a deferred download there. The landing page's brief also required the four technologies, if each could be given a genuine role.

## Decision

- The landing page has a 3D stage, the **light table** ([landing-page-design.md](../landing-page-design.md)). It uses three.js's `WebGPURenderer` inside React Three Fiber, with materials and a droplet simulation written in TSL. WebGPU is used where available, with automatic fallback to the renderer's WebGL 2 backend, and to an SVG drawing when neither works.
- The 3D code is a lazy chunk under `assets/3d/`. It loads only when the landing page's stage is about to be seen, and is excluded from the service worker's precache. The app's own screens are unchanged and never load it.
- Spline is integrated through its official React component for one designer-authored scene, enabled by a build-time URL, with the CSP opened only for configured origins (`SPLINE_ORIGINS`). No original scene exists yet; see the design document for the blocker and the remaining step.

## Consequences

- The landing page's first paint does not wait for any of this: 180 ms unthrottled and 1.7 s on emulated slow 4G with a 4× CPU slowdown, measured. The table's first frame follows at 0.94 s and 4.8 s respectively.
- About 360 KB gzip of JavaScript (281 KiB over the wire as Brotli) for visitors who reach the stage. It is cached after the first visit, and never downloaded by people using the app.
- One more rendering path to keep healthy. The end-to-end suite covers WebGPU or WebGL 2 rendering, settling, off-screen idling, the demo, reduced motion and the no-3D fallback.
- ADR 0005's reasoning still holds for the app itself: no GPU context competes with the editor.
