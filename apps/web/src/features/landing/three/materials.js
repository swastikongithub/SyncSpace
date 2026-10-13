// Node materials for the light table, written in TSL so the same source compiles to WGSL on the
// WebGPU backend and to GLSL on the WebGL 2 fallback.
//
// Every sheet is printed with a 45° halftone dot screen in its own coordinates. Copies in
// register put their dots on the same spots; a copy turned even a degree away makes the screens
// beat against each other, and that interference (moiré) is the picture of copies disagreeing.
// Sheets combine by multiplying their transmittance, as translucent film does on a light table.
import {
  abs,
  clamp,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  If,
  length,
  Loop,
  max,
  min,
  mix,
  normalGeometry,
  positionGeometry,
  positionLocal,
  rotate,
  select,
  smoothstep,
  sqrt,
  step,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl';
import { AddEquation, Color, CustomBlending, DoubleSide, DstColorFactor, MeshBasicNodeMaterial, OneFactor, Vector4, ZeroFactor } from 'three/webgpu';
import { CONTENT } from '../animator.js';
import { MAX_ROWS } from '../choreography.js';

const SCREEN_ANGLE = Math.PI / 4;

/** Multiply blending: the destination is darkened by the material's colour, alpha untouched. */
function multiply(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = DstColorFactor;
  material.blendDst = ZeroFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

/** Anti-aliased disc of radius `radius` (cell units) at distance `d` from the cell centre. */
const disc = (d, radius, aa) => smoothstep(radius.add(aa), radius.sub(aa), d);

/** Signed distance to a rounded rectangle centred at the origin. */
const roundedBox = Fn(([p, half, radius]) => {
  const q = abs(p).sub(half).add(radius);
  return length(max(q, 0)).add(min(max(q.x, q.y), 0)).sub(radius);
});

/**
 * @param {{ paper: string, screen: string, ink: string, wet: string, tint: number, paperRect: number[] }} spec
 *   paperRect: [centreX, centreY, halfWidth, halfHeight] in the sheet's content frame
 */
export function createSheetMaterial(spec) {
  const u = {
    paper: uniform(new Color(spec.paper)),
    screen: uniform(new Color(spec.screen)),
    ink: uniform(new Color(spec.ink)),
    wetInk: uniform(new Color(spec.wet)),
    tint: uniform(spec.tint),
    visible: uniform(1),
    pitch: uniform(0.0125),
    curl: uniform(0),
    paperRect: uniform(new Vector4(...spec.paperRect)),
    rows: uniformArray(Array.from({ length: MAX_ROWS }, () => new Vector4(0, 0, 0, 0))),
    wetness: uniformArray(Array.from({ length: MAX_ROWS }, () => new Vector4(0, 0, 0, 0))),
    carets: uniformArray([new Vector4(0, 0, 0, 0), new Vector4(0, 0, 0, 0)]),
    caretInk: uniformArray([new Color('#a42a4b'), new Color('#1d5fa8')]),
  };

  const material = multiply(new MeshBasicNodeMaterial({ side: DoubleSide }));

  // A lifted sheet curls a little at its far edge, the way paper does when picked up.
  material.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    const along = clamp(p.y.sub(u.paperRect.y).div(u.paperRect.w).mul(0.5).add(0.5), 0, 1);
    p.z.addAssign(u.curl.mul(along.mul(along)).mul(0.09));
    return p;
  })();

  material.colorNode = Fn(() => {
    const p = positionGeometry.xy;

    // Halftone cell of this fragment, and that cell's centre in content coordinates.
    const q = rotate(p, SCREEN_ANGLE).div(u.pitch);
    const cell = floor(q);
    const offset = fract(q).sub(0.5);
    const centre = rotate(cell.add(0.5).mul(u.pitch), -SCREEN_ANGLE);
    const d = length(offset);
    const aa = max(fwidth(d), 0.0001);

    // Which printed row covers the cell centre, and how wet its ink is.
    const coverage = float(0).toVar();
    const wet = float(0).toVar();
    Loop(MAX_ROWS, ({ i }) => {
      const row = u.rows.element(i);
      const inside = step(abs(centre.y.sub(row.x)), row.y)
        .mul(step(CONTENT.left, centre.x))
        .mul(step(centre.x, row.z.add(CONTENT.left)))
        .mul(row.w);
      If(inside.greaterThan(coverage), () => {
        coverage.assign(inside);
        wet.assign(u.wetness.element(i).x);
      });
    });

    // Dots. Wet ink spreads (dot gain) and dries back to its printed size.
    const textRadius = sqrt(coverage).mul(0.38).mul(wet.mul(0.3).add(1));
    const tintRadius = sqrt(u.tint.div(Math.PI));
    let text = disc(d, textRadius, aa).mul(step(0.001, coverage));
    let tintDot = disc(d, tintRadius, aa).mul(step(0.001, u.tint));

    // Where a cell is smaller than about three pixels the dots would alias against the pixel grid
    // (a moiré of its own); blend towards the dots' average tone there instead.
    const cellsPerPixel = fwidth(q.x);
    const blur = smoothstep(0.24, 0.42, cellsPerPixel);
    text = mix(text, coverage.mul(textRadius.mul(textRadius).mul(Math.PI)), blur);
    tintDot = mix(tintDot, u.tint, blur);

    // Registration targets at the middle of each margin: a ring and a cross.
    const mark = float(0).toVar();
    for (const [x, y] of [
      [0, 0.668],
      [0, -0.69],
      [-0.468, -0.01],
      [0.468, -0.01],
    ]) {
      const t = p.sub(vec2(x, y));
      const ring = abs(length(t).sub(0.016));
      const cross = min(max(abs(t.x), abs(t.y).sub(0.03)), max(abs(t.y), abs(t.x).sub(0.03)));
      const sd = min(ring, cross).sub(0.0016);
      mark.assign(max(mark, smoothstep(fwidth(sd), fwidth(sd).negate(), sd)));
    }

    // Collaborators' carets: thin upright bars at the end of the line they are typing.
    const caret = vec3(1).toVar();
    for (let index = 0; index < 2; index += 1) {
      const c = u.carets.element(index);
      const t = p.sub(c.xy);
      const sd = max(abs(t.x).sub(0.0035), abs(t.y).sub(0.024));
      const amount = smoothstep(fwidth(sd), fwidth(sd).negate(), sd).mul(c.z);
      caret.mulAssign(mix(vec3(1), u.caretInk.element(index), amount));
    }

    // Paper: its tint, a faint edge, and nothing outside its rounded rectangle.
    const local = p.sub(u.paperRect.xy);
    const edgeDistance = roundedBox(local, u.paperRect.zw, float(0.012));
    const inPaper = smoothstep(fwidth(edgeDistance), fwidth(edgeDistance).negate(), edgeDistance);
    const edge = smoothstep(0.004, 0.0, abs(edgeDistance.add(0.002)));

    const ink = mix(u.ink, u.wetInk, wet);
    const colour = vec3(u.paper).toVar();
    colour.mulAssign(mix(vec3(1), u.screen, tintDot));
    colour.mulAssign(mix(vec3(1), ink, text));
    colour.mulAssign(mix(vec3(1), u.ink, mark.mul(0.9)));
    colour.mulAssign(caret);
    colour.mulAssign(mix(1, 0.8, edge));
    return mix(vec3(1), colour, inPaper.mul(u.visible));
  })();

  return { material, uniforms: u };
}

/**
 * The light pad: a slab whose top is backlit glass (an even glow, a faint cutting grid, a thin
 * bezel) and whose edges are brushed aluminium, shaded by a fixed room light.
 * Geometry: a rounded rectangle extruded along +z (see sheets.js), so the top face has normal +z.
 */
export function createPadMaterial({ size }) {
  const u = {
    glow: uniform(new Color('#fcfbff')),
    grid: uniform(new Color('#dcd8ea')),
    bezel: uniform(new Color('#cfccd9')),
    metal: uniform(new Color('#a9a5b8')),
  };
  const material = new MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const p = positionGeometry.xy;
    const sd = roundedBox(p, vec2(size[0] / 2, size[1] / 2), float(0.045));

    const lines = (spacing, width) => {
      const g = abs(fract(p.div(spacing).add(0.5)).sub(0.5)).mul(spacing);
      const w = fwidth(p.x).mul(width);
      return max(smoothstep(w, 0, g.x), smoothstep(w, 0, g.y));
    };
    const minor = lines(0.1, 0.9).mul(0.3);
    const major = lines(0.5, 1.3).mul(0.7);
    const falloff = smoothstep(0.0, -0.8, sd); // brighter towards the middle of the glass
    const glass = mix(u.glow.mul(0.94), u.glow, falloff);
    const gridded = mix(glass, u.grid, max(minor, major).mul(step(sd, -0.05)));
    const bezelMask = smoothstep(-0.034, -0.03, sd);
    const top = mix(gridded, u.bezel, bezelMask);

    // Edges: lit from above and slightly in front.
    const light = normalGeometry.dot(vec3(0.2, -0.55, 0.8).normalize()).mul(0.5).add(0.5);
    const side = u.metal.mul(light.mul(0.45).add(0.6));
    return select(normalGeometry.z.greaterThan(0.5), top, side);
  })();
  return { material, uniforms: u };
}

/** The desk around the pad, with the pad's light spilling onto it. */
export function createDeskMaterial({ size }) {
  const u = {
    surround: uniform(new Color('#e6e4ec')),
    spill: uniform(new Color('#f4f2fb')),
    strength: uniform(0.55),
  };
  const material = new MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    const p = positionGeometry.xy;
    const sd = roundedBox(p, vec2(size[0] / 2, size[1] / 2), float(0.045));
    const spill = max(sd, 0).mul(-5.5).exp().mul(u.strength);
    const contact = smoothstep(0.05, 0.0, sd).mul(0.12); // a thin shadow where the slab meets the desk
    return mix(mix(u.surround, u.spill, spill), u.surround.mul(0.7), contact);
  })();
  return { material, uniforms: u };
}

/** A soft shadow cast on the glass by a lifted sheet (room light from above). */
export function createShadowMaterial(paperRect) {
  const u = {
    amount: uniform(0),
    blur: uniform(0.02),
    tone: uniform(new Color('#4d4866')),
  };
  const material = multiply(new MeshBasicNodeMaterial());
  material.colorNode = Fn(() => {
    const p = positionGeometry.xy.sub(vec2(paperRect[0], paperRect[1]));
    const sd = roundedBox(p, vec2(paperRect[2], paperRect[3]), float(0.02));
    const shade = smoothstep(u.blur, u.blur.negate(), sd).mul(u.amount);
    return mix(vec3(1), u.tone, shade);
  })();
  return { material, uniforms: u };
}
