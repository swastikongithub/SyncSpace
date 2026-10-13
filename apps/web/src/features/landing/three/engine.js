// The light table's imperative side: the objects in the scene, the animator moving them, the
// camera, the droplets, and the visitor's drag. React (LightTable.jsx) creates one engine per
// renderer, forwards events and story changes to it, and asks it each frame whether another frame
// is needed; everything that mutates three.js objects lives here.
import { Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { createAnimator, layoutTargets, retarget } from '../animator.js';
import { chapterTargets, reconnectFlow } from '../choreography.js';
import { SHEET_SPECS } from '../sheet-specs.js';
import { CameraRig } from './camera.js';
import { createDroplets, FLOW } from './droplets.js';
import { createTableScene } from './sheets.js';

/** The scattered pile the page opens with, before the copies settle into register. */
function openingTargets(targets) {
  const scatter = { key: [0, 0, 0, 0], you: [0.06, 0.05, -7, 0.1], ana: [-0.05, -0.04, 5.5, 0.06], ben: [0.03, -0.06, -3.2, 0.13] };
  return {
    ...targets,
    sheets: Object.fromEntries(
      Object.entries(targets.sheets).map(([id, sheet]) => {
        const [x, z, turn, lift] = scatter[id];
        return [id, { ...sheet, transform: { x, z, turn, lift } }];
      }),
    ),
  };
}

/** How many droplets this device simulates: fewer on the WebGL fallback and on small screens. */
function dropletCount(renderer) {
  const small = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
  if (!renderer.backend.isWebGPUBackend) return small ? 2048 : 4096;
  return small ? 6144 : 12288;
}

const now = () => performance.now() / 1000;

export class LightTableEngine {
  constructor(renderer, { pitch, framing }) {
    this.renderer = renderer;
    this.pitch = pitch;
    this.animator = createAnimator();
    this.table = createTableScene();
    this.rig = new CameraRig(framing === 'sheets' ? 0.97 : 1.2);
    this.droplets = createDroplets(dropletCount(renderer));
    this.table.root.add(this.droplets.sprite);
    this.root = this.table.root;
    this.pointer = { x: 0, y: 0 };
    this.flow = null; // { start, source, copies } while droplets are in the air
    this.previous = null;
    this.drag = null;
    this.raycaster = new Raycaster();
    this.ndc = new Vector2();
    this.glass = new Plane(new Vector3(0, 1, 0), 0);
    this.hit = new Vector3();
  }

  setColours(colours) {
    this.table.setColours(colours);
  }

  /** Follows the story. The first call opens with the copies scattered unless `motion` is false. */
  show(state, { motion }) {
    const targets = chapterTargets(state);
    const t = now();
    if (this.previous === null) {
      if (motion) this.animator.setTargets(openingTargets(targets), t, { instant: true });
      this.animator.setTargets(targets, t, { instant: !motion });
      this.rig.setPreset(targets.camera, !motion);
      this.previous = state;
      return;
    }
    const reconnect = motion ? reconnectFlow(this.previous, state) : null;
    if (reconnect) {
      // The droplets carry the rows; receiving copies print them as they land.
      this.animator.hold(reconnect.holds, t);
      const layout = layoutTargets(reconnect.layoutFrom);
      const u = this.droplets.uniforms;
      this.droplets.setRows('source', reconnect.rows.map((index) => layout[index]));
      this.droplets.setRows('return', reconnect.returnRows.map((index) => layout[index]));
      u.wetInk.value.set(SHEET_SPECS[reconnect.source].wet);
      u.inkA.value.set(SHEET_SPECS[reconnect.copies[0]].ink);
      u.inkB.value.set(SHEET_SPECS[reconnect.copies[1]].ink);
      this.flow = { start: t, source: reconnect.source, copies: reconnect.copies };
    } else if (state.chapter !== this.previous.chapter) {
      this.flow = null;
    }
    this.animator.setTargets(targets, t, { instant: !motion });
    this.rig.setPreset(targets.camera, !motion);
    this.previous = state;
  }

  // ---- Pointer --------------------------------------------------------------------------

  aim(camera, x, y) {
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, camera);
  }

  /** Whether the pointer (normalised device coordinates) is over your copy. */
  overYourCopy(camera, x, y) {
    this.aim(camera, x, y);
    return this.raycaster.intersectObject(this.table.sheets.you.mesh, false).length > 0;
  }

  /** Starts dragging your copy if the pointer is on it. Returns true when a drag began. */
  startDrag(camera, x, y) {
    if (!this.overYourCopy(camera, x, y) || !this.raycaster.ray.intersectPlane(this.glass, this.hit)) return false;
    this.drag = { x: this.hit.x, z: this.hit.z };
    return true;
  }

  moveDrag(camera, x, y) {
    if (!this.drag) return;
    this.aim(camera, x, y);
    if (!this.raycaster.ray.intersectPlane(this.glass, this.hit)) return;
    const dx = Math.max(-0.35, Math.min(0.35, this.hit.x - this.drag.x));
    const dz = Math.max(-0.35, Math.min(0.35, this.hit.z - this.drag.z));
    const transform = this.animator.sheets.you.transform;
    retarget(transform.x, dx, 0);
    retarget(transform.z, dz, 0);
    retarget(transform.turn, Math.max(-9, Math.min(9, dx * 24)), 0);
    retarget(transform.lift, 0.06 + Math.hypot(dx, dz) * 0.25, 0);
  }

  /** Lets go: your copy returns to wherever the story puts it. */
  endDrag(state) {
    if (!this.drag) return;
    this.drag = null;
    this.animator.setTargets(chapterTargets(state), now());
  }

  setPointer(x, y) {
    this.pointer.x = x;
    this.pointer.y = y;
  }

  // ---- Frames ---------------------------------------------------------------------------

  /** Advances one frame. Returns true while another frame is needed. */
  frame(camera, size, delta) {
    // The springs are stable at any step, so animations keep real time even at a few frames per
    // second; the droplets' explicit integration takes smaller steps (they land on time regardless).
    const dt = Math.min(delta, 0.1);
    const t = now();
    const moving = this.animator.step(dt, t);
    this.table.update(this.animator, { pitch: this.pitch });
    const cameraMoving = this.rig.step(camera, size, this.pointer, dt);

    // Droplets: one compute pass per frame while a flow is in the air, none otherwise.
    let flowing = false;
    if (this.flow) {
      const elapsed = t - this.flow.start;
      if (elapsed > FLOW.end) {
        this.flow = null;
      } else {
        this.root.updateMatrixWorld(true);
        const u = this.droplets.uniforms;
        const sheets = this.table.sheets;
        u.time.value = elapsed;
        u.dt.value = Math.min(dt, 1 / 30);
        u.source.value.copy(sheets[this.flow.source].mesh.matrixWorld);
        u.server.value.copy(sheets.key.mesh.matrixWorld);
        u.copyA.value.copy(sheets[this.flow.copies[0]].mesh.matrixWorld);
        u.copyB.value.copy(sheets[this.flow.copies[1]].mesh.matrixWorld);
        this.renderer.compute(this.droplets.update);
        flowing = true;
      }
    }
    this.droplets.sprite.visible = flowing;
    this.lastFrame = { dt, moving, cameraMoving, flowing };
    return moving || cameraMoving || flowing;
  }

  /** For ?stage-debug: what the last frame saw, and which values are still moving. */
  diagnose(size) {
    const unsettled = [];
    const check = (name, c) => {
      if (c.pending || Math.abs(c.target - c.value) > 0.0005 || Math.abs(c.velocity) > 0.0005) {
        unsettled.push(`${name} ${c.value.toFixed(4)}>${c.target}${c.pending ? ' (pending)' : ''}`);
      }
    };
    for (const [id, sheet] of Object.entries(this.animator.sheets)) {
      check(`${id}.visible`, sheet.visible);
      for (const [field, c] of Object.entries(sheet.transform)) check(`${id}.${field}`, c);
      sheet.rows.forEach((row, index) => ['present', 'length', 'wet', 'gap', 'heading'].forEach((field) => check(`${id}.r${index}.${field}`, row[field])));
    }
    for (const [field, c] of Object.entries(this.rig.channels)) check(`camera.${field}`, c);
    return { ...this.lastFrame, size: `${size.width}x${size.height}`, flow: Boolean(this.flow), unsettled: unsettled.slice(0, 5), count: unsettled.length };
  }

  dispose() {
    this.root.remove(this.droplets.sprite);
    this.droplets.dispose();
    this.table.dispose();
  }
}
