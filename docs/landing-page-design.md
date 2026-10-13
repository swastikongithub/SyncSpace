# The landing page: design and technology

The public page at `/` (people signed in on the device still go straight to their workspace). It was designed for this product without external references or templates. The design skills (frontend-design, UI/UX Pro Max, and the design plugin's critique and accessibility lenses) informed the process; they did not choose the look. See [design-skills.md](design-skills.md).

## 1. What the page has to do

Visitors arrive knowing nothing. In a few seconds the page must say what SyncSpace is (a shared document editor), why it is different (every device keeps a full copy, so writing never waits for the network), and show the central idea working. Then it must lead somewhere real: create an account, sign in, or try the merge in the page without an account.

Everything on the page describes the product as it is. The copy was checked against the code: the status lines quoted are the app's exact strings (`describeSync` in `apps/web/src/sync/status.js`), the features listed exist, and the screenshots are of the app with its demo data. There are no customers, logos, testimonials, or performance claims on the page.

## 2. Directions considered

| Direction | Idea | Verdict |
|---|---|---|
| **A. The light table** | Proofing copies on a backlit table. Each copy of a document is a translucent sheet printed with a halftone dot screen. Copies that agree print their dots on the same spots and read as one page. A copy holding edits the others lack is lifted and turned, and its screen beats against the others as **moiré**: interference you can see, made of the disagreement itself. On reconnect, its unsent ink travels to the server's film and then to the other copies, and the sheets settle back into register. | **Chosen.** It extends the app's existing identity (carbon copies, plies, registration, wet ink; see [design.md](design.md)) instead of inventing a second brand. And it is literally true to the model: identical replicas coincide, divergent ones don't. |
| B. Constellation | Devices as glowing nodes, edits as particles along edges. | Rejected: the default picture of anything networked, and it says nothing about *agreement*. |
| C. Ink in water | A fluid simulation of wet ink spreading as you type, drying on sync. | Rejected as the main idea: a familiar effect, heavy on phones. Kept in small form: wet ink spreads (dot gain) and dries, and droplets carry it. |
| D. Archive flythrough | A camera flight through stacks of documents. | Rejected: spectacle unrelated to the promise, and a long scroll-jacked sequence. |
| E. Device diorama | A modelled laptop, phone and server. | Not the main idea (literal and generic), but it is the kind of hand-modelled object Spline is good at, so it became the **Spline** brief (§7). |

### Why moiré

Moiré is what printers see on a light table when films are out of register. For SyncSpace it is not decoration but the state itself:

| Product fact | On the table |
|---|---|
| Every device has a full copy | One sheet per copy: yours (violet), Ana's (rose), Ben's (blue), the server's (clear film) |
| Copies that agree are identical | Sheets in register: rows and registration targets coincide, and the screens make no moiré |
| An offline device holds edits the server lacks | Your sheet lifts and turns; its new paragraph is wet ink; moiré appears where it overlaps |
| "Stored on server" only after MongoDB has the change | Your ink dries only when the droplets reach the server's film, not when they leave |
| CRDT merging combines edits | Rows arriving on a copy push the rows below them down; nothing is overwritten |
| Versions and restore | Earlier versions slide out as smaller proofs beside the current copy |

## 3. Token plan (frontend-design pass 1)

**Colour.** The app's tokens (desk `#E6E4EC`/`#14121C`, sheet, ink `#211D33`, carbon `#4B3FC4`, ply inks) plus the table's own:

| Name | Value | Role |
|---|---|---|
| Glass | `#FDFCFF` (dark: `#EBE8F4`) | The backlit surface. Dimmer in dark mode to avoid glare. |
| Bezel / metal | `#D3D0DD`, `#AAA6B9` (dark: `#46415E`, `#4A4562`) | Aluminium edge of the pad, so it reads as an object, not a screen |
| Spill | `#F6F5FB` (dark: `#3B3656`) | The pad's light falling on the desk; it makes the pad a lamp in dark mode |
| Ply inks | violet `#4B3FC4` (wet `#7B6FE8`), rose `#A42A4B`, blue `#1D5FA8`, film `#3B3650` | Each copy's ink. They multiply where sheets overlap, as real overprint does. |

**Type.** As in the app: Literata for headlines (optical size 72 for the display line), Atkinson Hyperlegible Next for everything else. The headline arrives with its carbon plate offset and settles into register over 1.1 s, the same moment the table plays, then the plate fades. It is a decorative `aria-hidden` duplicate, removed under reduced motion.

**Layout.**

```
Desktop (>= 1024 px)                              Phone
+------------------------------------------+     +------------------+
| SyncSpace  Offline  How it works  Try it |     | SyncSpace  [CTA] |
|            Sign in [Create an account]   |     +------------------+
+-------------------+----------------------+     | Headline         |
| Headline          |                      |     | Lede, CTAs       |
| Lede, CTAs        |   LIGHT TABLE        |     +------------------+
|                   |   (sticky; changes   |     | LIGHT TABLE band |  <- sticky under
| Together          |    with the chapter  |     | (38svh)          |     the header
| Offline           |    in view)          |     +------------------+
| Stored            |                      |     | Chapters, demo   |
| History           |   caption + control  |     | scroll beneath   |
| Try it (live demo)|                      |     +------------------+
+-------------------+----------------------+     | Workspace ...    |
| What's in a workspace (definition list)  |     +------------------+
| Laptop and phone (screenshots / Spline)  |
| How a keystroke becomes stored (1-5)     |
| Start a workspace (a blank sheet)        |
| Footer + colophon                        |
+------------------------------------------+
```

Text is left-aligned with a ~34 rem measure. Numbers are used once, for the five steps of how a keystroke is stored, because that content is a sequence.

**Principles.** (1) One stage, one story: the same four copies are shown throughout, so state changes are legible as changes. (2) The HTML carries the message; the stage illustrates it and is never required. (3) Motion answers the reader (scroll, drag, the demo) and then stops. (4) Say only what is true.

## 4. Review against generic defaults (frontend-design pass 2)

| Plan element | Default it risks | Decision |
|---|---|---|
| Sticky 3D stage beside scrolling chapters | "Apple-style" scrollytelling | Kept, because the story is one set of objects changing state, which needs a persistent stage. Scroll is never hijacked; chapters are normal flow; no pinned scrubbing. |
| Big serif headline on a light page | Cream + serif + clay | Lilac-grey desk, carbon violet, and the serif already belongs to the product. The headline's type treatment is the registration moment, not an accent word. |
| Feature list | Card grid with icons | A plain definition list, no cards, no icons. |
| Device screenshots | Floating mockup frames | Real screenshots as proofs on the desk, no device chrome. |
| Particle effect | Decorative sparkles | Droplets exist only while edits travel. Their timing is the protocol's: they land on the server first, and ink dries only then. |
| Colophon | Tech-logo strip | One sentence that reports, live, which renderer is drawing on this device. |

Rejected from the generic list in [design-skills.md](design-skills.md): eyebrows, ALL-CAPS labels, `A · B · C` meta strings, `→` on buttons, fade-up on every section, gradient washes, stats bands.

## 5. Technology: what runs where

| Technology | Where | What it does | Verified by |
|---|---|---|---|
| **Three.js** (r186, `three/webgpu`) | `features/landing/three/` | All scene content is custom. Sheets are subdivided planes curled in the vertex stage. The pad is an extruded rounded slab. Materials are hand-written in **TSL** (three.js shading language): a 45° halftone dot screen per sheet with rows read from uniform arrays, wet-ink dot gain, registration targets and carets as signed-distance shapes, multiply blending for overprint, glass with a cutting grid and bezel, desk light spill, soft lifted-sheet shadows, and anti-aliasing that fades dots to their average tone when a cell is under ~3 px. | Unit tests (choreography, animator, layout); screenshots of every chapter (light, dark, desktop, phone); e2e checks that the stage renders |
| **React Three Fiber** (9.8.1) | `three/LightTable.jsx` | Hosts the scene in React: `<Canvas>` with an async renderer factory, `frameloop="demand"`, DPR caps, and no scroll re-measure. It owns the lifecycle (creating and disposing the engine, colour-scheme and pointer listeners) and the frame callback. A plain JS engine (`three/engine.js`) does the per-frame mutation, so React never re-renders during animation. | e2e: frames stop when idle and off screen; drag test; lint (React Compiler rules) |
| **WebGPU** | Renderer factory in `LightTable.jsx`; `three/droplets.js` | `WebGPURenderer` initialises asynchronously and uses WebGPU when the browser grants an adapter. On reconnect, a **TSL compute shader** simulates 12,288 ink droplets (6,144 on phones) in storage buffers: velocity integration, a moving target, drag and swirl. If WebGPU is unavailable, the same renderer runs its **WebGL 2 backend**: TSL compiles to GLSL, and compute runs through transform feedback with 4,096 droplets. | A real WebGPU adapter (NVIDIA Lovelace) in Chromium 156; WebGL 2 fallback in headless Chromium; buffers read back from the GPU on both backends during development; the colophon and `data-renderer` report the backend actually in use |
| **Spline** (`@splinetool/react-spline` 4.1.0, runtime 2.0.79) | `DevicesSection.jsx`, `SplineDesk.jsx` | Integration boundary for an original, designer-authored scene of the devices: lazy, mounted near the viewport, paused off screen, with an HTML control for its one interaction and the "Made with Spline" credit. **No original scene exists yet** (§7). | Smoke test with Spline's documented example scene (not committed): loads under the CSP with `SPLINE_ORIGINS` set; with it unset, the CSP blocks the fetch and the screenshots remain |

Three.js and React Three Fiber are one feature: R3F hosts the three.js scene; they are not two effects. WebGPU is the renderer underneath that feature, with WebGL 2 as its automatic fallback.

## 6. Loading, fallbacks and performance

**Tiers.** `StageFrame.jsx` decides, before downloading anything:

1. `?stage=poster`, or data saver on, shows the SVG poster. Data saver offers a "Load the 3D table" button.
2. `navigator.gpu` present: try WebGPU. The renderer falls back to WebGL 2 by itself if no adapter is granted.
3. No WebGPU but WebGL 2 present: start on the WebGL 2 backend directly. `?renderer=webgl` forces this.
4. Neither: the poster, with a sentence saying why.

Renderer initialisation errors, chunk load failures (for example offline) and device loss all return to the poster through an error boundary. The poster is the same table drawn in SVG, following the same chapters, and its dot patterns make real moiré when a copy is turned. It is visible from the first paint until the 3D canvas has drawn, then cross-fades out.

**Cost control.**

- The 3D code is a lazy chunk (`assets/3d/`, about 360 KB gzip, 281 KiB as Brotli on the wire). It is requested only when the stage is within a screen of the viewport and the browser is idle (at most 0.9 s after paint).
- It is excluded from the service worker precache and cached on first use, so app users never download it for offline use.
- `three` resolves to the WebGPU build (`three-for-r3f.js`), which keeps the classic WebGLRenderer out of the bundle (−80 KB gzip).
- Frames are drawn on demand only while something moves and the stage is on screen. A settled page draws nothing; the e2e suite asserts this.
- The springs are unconditionally stable, so animation keeps real time at low frame rates. Droplets run one compute pass per frame, only while in the air.
- DPR is capped (1.75; 1.5 on touch devices), and phones get a coarser dot screen and fewer droplets.
- The main bundle grew by about 7 KB gzip for the landing page's HTML, poster and choreography.

**Measured** with [`scripts/measure-landing.js`](../scripts/measure-landing.js) on 2026-10-14. These are cold loads from the production build served over loopback by the real server, on Windows 11 with an i7-13700HX and Chromium 156.0.8078.4, whose WebGPU adapter reports as NVIDIA Lovelace (an RTX 4060 Laptop GPU), three runs each. Raw data: [measurements/2026-10-14-landing.json](measurements/2026-10-14-landing.json).

| Device / network | First contentful paint | 3D renderer ready | First 3D frame | Transferred (of which 3D) |
|---|---|---|---|---|
| Desktop 1440×900, unthrottled | 180 ms | 882 ms | 938 ms | 587 KiB (281) |
| Desktop, slow 4G + 4× CPU slowdown | 1,724 ms | 4,462 ms | 4,789 ms | 587 KiB (281) |
| Pixel 7 emulation, unthrottled | 200 ms | 898 ms | 959 ms | 587 KiB (281) |
| Pixel 7 emulation, slow 4G + 4× CPU | 1,808 ms | 4,635 ms | 5,118 ms | 587 KiB (281) |

Largest contentful paint equals first contentful paint in every run: the largest element is the headline text, which does not wait for the 3D. Before the server sent precompressed assets (built in the same change), the slow-4G figures were 3.7 s to first paint and 11.5 s to the first 3D frame, with 1,983 KiB transferred.

These are emulated conditions on a fast machine with a discrete GPU. No physical phone or low-end GPU was available to test.

## 7. Spline

**Status: integration built and smoke-tested; no original scene.** Authoring a scene requires the Spline editor. In this environment:

- `app.spline.design` redirected the connected Chrome to its sign-in page. Signing in, creating an account or granting Google sign-in on the owner's behalf was not appropriate.
- Spline's official agent route (its MCP server) runs inside the Spline desktop app, which is not installed.
- Spline's runtime and docs state there is no API that creates, saves or publishes a scene from code, and that `.splinecode` URLs cannot be derived. They must be copied from the editor's export panel.

Embedding someone else's scene would not meet the brief, so none is embedded.

**Scene contract** (what the code expects from the scene):

- A designer-authored composition of a laptop, a phone and a server for the "same page on a laptop and a phone" section, lit and finished in Spline. It should differ in kind from the light table: modelled objects rather than procedural, data-driven graphics.
- An object named **`Phone`** with a **mouseDown** event that plays an authored "offline" transition (for example, the phone lifts and its screen dims) and reverses on the next mouseDown. The page's "Take the phone offline" button triggers the same event with `emitEvent('mouseDown', 'Phone')`, and the page announces the state in text.

**Smallest remaining action** (about 30 minutes for someone with a Spline account):

1. Build the scene above in Spline and publish it: **Export → Code → React**. Copy the `scene.splinecode` URL.
2. Build with `VITE_SPLINE_SCENE_URL=<that URL>` (or `docker build --build-arg VITE_SPLINE_SCENE_URL=...`).
3. Run the server with `SPLINE_ORIGINS=https://prod.spline.design` (add `https://cdn.spline.design` if the scene uses WebAssembly features such as physics). The CSP stays strict otherwise. `'unsafe-eval'` is never needed: the runtime's one attempt at `eval` (msgpackr) is caught and falls back.

Without a URL, no Spline code is built, and the section shows the screenshots.

**Verified with Spline's documented example scene** (`react-spline` README; local only, never committed):

- It loads, renders and pauses off screen.
- The credit shows.
- Only `prod.spline.design` is contacted.
- With `SPLINE_ORIGINS` unset, the CSP blocks the fetch and the section falls back to the screenshots with one console warning.
- With a scene configured, the precache stays at 19 entries, because Spline's chunks live in `assets/3d`.
- The runtime bundles its own three.js, so the console warns about two three.js instances on the page. That is expected and harmless.

## 8. Accessibility

- **Semantics.** One `h1`, an `h2` per section, landmarks, and a skip link (from the app).
- **The stage.** It is a `figure` whose caption describes the current illustration. The canvas is `aria-hidden`; every fact it shows is in the text beside it. On narrow screens the caption is visually hidden but still read, because the chapter text below repeats it.
- **Equivalents.** The drag interaction has a button equivalent ("Pull my copy out of register", `aria-pressed`). Pointer-only extras (parallax, drag) need a fine pointer and motion enabled; touch scrolls the page.
- **Reduced motion.** It is live (a `matchMedia` listener). The headline plate is removed, the opening sequence is skipped, chapters jump to their end state, there are no droplets, and the poster does not transition.
- **Motion length.** Nothing animates on its own for more than about 3 seconds, so there is nothing to pause (WCAG 2.2.2).
- **Checks.** axe (WCAG 2.2 AA tags) reports no serious or critical violations. Contrast uses the app's verified tokens. There is no horizontal overflow at 320, 360 or 412 px wide (e2e).

## 9. Verification

| Check | Result |
|---|---|
| Unit tests (`features/landing/landing.test.js`) | 25 tests: chapter targets, the demo's mapping to rows, reconnect flows and their timing, animator settling, delays, typing, holds, layout |
| End-to-end (`e2e/landing.spec.js`, `e2e/landing-mobile.spec.js`) | 8 desktop and 1 phone test: CTAs and routes, the signed-in redirect, rendering, idle and off-screen frame counts, the live demo, the no-3D poster, `?stage=poster`, reduced motion, axe, overflow at 320–412 px |
| Server | CSP default vs `SPLINE_ORIGINS` (3 tests); precompressed static delivery (6 tests) |
| Browsers | Chromium with WebGPU (NVIDIA adapter); Chromium on the WebGL 2 fallback (SwiftShader); 3D APIs removed (poster); GitHub Actions' Linux runner (software rendering) |
| Not tested | Firefox and Safari (not installed); physical phones; low-end GPUs |

`?stage-debug` adds a `data-debug` attribute to the stage, recording why each frame was drawn. The 3D end-to-end tests use it, so a stage that never settles explains itself in CI logs.

## 10. Known limitations

- **Client-rendered page.** The landing page is part of the single-page app, so its text appears once the main bundle (160 KB gzip) has run, not with the HTML. Prerendering `/` would improve first paint further on slow networks.
- **Screenshots in dark mode.** The device screenshots are of the light theme.
- **Console warnings from dependencies.**
  - React Three Fiber 9.8.1 creates a `THREE.Clock`, which three r186 reports as deprecated.
  - With a Spline scene, two three.js instances are loaded.
- **Unexplained CI failure.** On GitHub's runner the first CI run of this page never stopped drawing (17 frames per second for over 50 seconds), although it settled locally even with a 6× CPU slowdown. After the animation step was changed to keep real time at low frame rates, CI passed on the first attempt. The original mechanism was not isolated; `?stage-debug` will show it if it returns.
- **Spline.** There is no original scene yet (§7).
