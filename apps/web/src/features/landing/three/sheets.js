// Builds the light table's objects: the glass, one sheet per copy (with the shadow it casts when
// lifted), and three proof sheets for history. Plain three.js objects owned by the scene component,
// which updates them every frame and disposes of them on unmount.
import { ExtrudeGeometry, Group, Mesh, PlaneGeometry, Shape } from 'three/webgpu';
import { ROWS } from '../choreography.js';
import { CONTENT, layoutRows } from '../animator.js';
import { createDeskMaterial, createPadMaterial, createShadowMaterial, createSheetMaterial } from './materials.js';
import { SHEET_SPECS } from '../sheet-specs.js';

const DEG = Math.PI / 180;

export const TABLE_SIZE = [1.78, 2.08];
const PAD_THICKNESS = 0.04;

function padGeometry([width, height], depth) {
  const r = 0.045;
  const w = width / 2;
  const h = height / 2;
  const shape = new Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.absarc(w - r, -h + r, r, -Math.PI / 2, 0);
  shape.lineTo(w, h - r);
  shape.absarc(w - r, h - r, r, 0, Math.PI / 2);
  shape.lineTo(-w + r, h);
  shape.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-w, -h + r);
  shape.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5);
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
}

function sheetGeometry([cx, cy, hw, hh], margin = 0) {
  const geometry = new PlaneGeometry((hw + margin) * 2, (hh + margin) * 2, 16, 24);
  geometry.translate(cx, cy, 0);
  return geometry;
}

function createSheet(id) {
  const spec = SHEET_SPECS[id];
  const { material, uniforms } = createSheetMaterial(spec);
  const mesh = new Mesh(sheetGeometry(spec.paperRect), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  const holder = new Group();
  holder.name = `sheet-${id}`;
  holder.add(mesh);

  const shadowParts = createShadowMaterial(spec.paperRect);
  const shadowMesh = new Mesh(sheetGeometry(spec.paperRect, 0.25), shadowParts.material);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.renderOrder = 1;
  const shadow = new Group();
  shadow.add(shadowMesh);

  return { id, spec, holder, mesh, uniforms, shadow, shadowUniforms: shadowParts.uniforms };
}

export function createTableScene() {
  const root = new Group();

  // The light pad: a rounded slab whose top face is the glass, on a desk that catches its light.
  const padParts = createPadMaterial({ size: TABLE_SIZE });
  const pad = new Mesh(padGeometry(TABLE_SIZE, PAD_THICKNESS), padParts.material);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = -PAD_THICKNESS;
  root.add(pad);

  const deskParts = createDeskMaterial({ size: TABLE_SIZE });
  const desk = new Mesh(new PlaneGeometry(9, 9), deskParts.material);
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -PAD_THICKNESS;
  root.add(desk);

  const sheets = Object.fromEntries(Object.keys(SHEET_SPECS).map((id) => [id, createSheet(id)]));
  for (const sheet of Object.values(sheets)) {
    root.add(sheet.shadow);
    root.add(sheet.holder);
  }

  const caretSlots = (rowId) => ROWS.findIndex((row) => row.id === rowId);

  return {
    root,
    sheets,

    /** Copies the animator's current values into transforms and uniforms. */
    update(animator, { pitch }) {
      for (const [id, sheet] of Object.entries(sheets)) {
        const state = animator.sheets[id];
        const t = state.transform;
        const visible = Math.max(0, Math.min(1, state.visible.value));
        const versionIndex = id.startsWith('v') ? Number(id.slice(1)) - 1 : -1;

        let lift = t.lift.value;
        let x = t.x.value;
        let z = t.z.value;
        let turn = t.turn.value;
        let scale = 1;
        if (versionIndex >= 0) {
          // Earlier versions slide out from under the stack as smaller proofs, oldest at the top.
          scale = 0.42;
          x = -0.52 + (1 - visible) * 0.5;
          z = -0.63 + versionIndex * 0.63;
          lift = 0.002 + versionIndex * 0.001;
          turn = [-2.5, 1.4, -0.8][versionIndex] * visible;
        }

        sheet.holder.scale.setScalar(scale);
        sheet.holder.position.set(x, sheet.spec.level + lift, z);
        sheet.holder.rotation.y = -turn * DEG;
        sheet.mesh.visible = visible > 0.002;
        sheet.uniforms.visible.value = visible;
        sheet.uniforms.curl.value = Math.min(lift * 1.4, 0.4);
        sheet.uniforms.pitch.value = pitch;

        // A lifted sheet's shadow falls away from the room light and softens with height.
        const shadowLift = versionIndex >= 0 ? 0 : lift;
        sheet.shadow.position.set(x + shadowLift * 0.28, 0.0006, z + shadowLift * 0.2);
        sheet.shadow.rotation.y = -turn * DEG;
        sheet.shadow.visible = shadowLift > 0.004 && visible > 0.002;
        sheet.shadowUniforms.amount.value = Math.min(shadowLift * 2.4, 0.3) * visible;
        sheet.shadowUniforms.blur.value = 0.015 + shadowLift * 0.4;

        const rows = layoutRows(state);
        rows.forEach((row, index) => {
          sheet.uniforms.rows.array[index].set(row.y, row.halfHeight, row.length, row.density * visible);
          sheet.uniforms.wetness.array[index].x = row.wet;
        });

        // Carets are printed once, on the server's film, so their colour stays true.
        if (id === 'key') {
          animator.caretRows.forEach((rowId, index) => {
            const slot = rowId ? caretSlots(rowId) : -1;
            const caret = sheet.uniforms.carets.array[index];
            if (slot < 0) {
              caret.set(0, 0, 0, 0);
              return;
            }
            const row = rows[slot];
            caret.set(CONTENT.left + row.length + 0.007, row.y, animator.carets[index].value * row.density, 0);
          });
        }
      }
    },

    setColours({ surround, spill, spillStrength, glow, grid, bezel, metal }) {
      deskParts.uniforms.surround.value.set(surround);
      deskParts.uniforms.spill.value.set(spill);
      deskParts.uniforms.strength.value = spillStrength;
      padParts.uniforms.glow.value.set(glow);
      padParts.uniforms.grid.value.set(grid);
      padParts.uniforms.bezel.value.set(bezel);
      padParts.uniforms.metal.value.set(metal);
    },

    dispose() {
      root.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
    },
  };
}
