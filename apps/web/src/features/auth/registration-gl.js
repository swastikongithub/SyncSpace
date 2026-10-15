// Draws the sign-in pages' light table with one WebGL2 fragment shader (no libraries): backlit
// glass with a cutting grid, the server's film and this device's copy, each printed with a 45°
// halftone screen of the same page. Out of register, the two screens beat as moiré; in register,
// every dot lands on its twin. Light themes overprint (multiply), dark themes add light (screen).
// Frames are drawn only while something moves. See registration.js for the poses.
import { ENTRANCE, createSpring, sheetLayout, springSettled, stepSpring } from './registration.js';

const VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;       // drawing buffer, device px
uniform float uDpr;
uniform float uDark;     // 0 multiply (light theme), 1 screen (dark theme)
uniform vec3 uGlass;
uniform vec3 uGlow;
uniform vec3 uGrid;
uniform vec3 uFilmInk;
uniform vec3 uInk;
uniform vec3 uWetInk;
uniform vec3 uPaper;
uniform vec4 uSheet;     // film centre and half size, CSS px, y down
uniform vec3 uMine;      // this device's offset (CSS px) and turn (radians)
uniform float uWet;
uniform float uPrinted;
uniform float uLift;
uniform float uCell;     // halftone cell, CSS px

// The page, in slots of one line pitch: a title, a byline, a picture (slots 2.5 to 8.3), then
// two paragraphs. LINES holds each slot's line length (0 = no line), HALF its half thickness.
const int SLOTS = 18;
const float LINES[18] = float[18](0.6, 0.32, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.97, 0.99, 0.56, 0.0, 1.0, 0.93, 0.98, 0.42);
const float HALF[18] = float[18](0.34, 0.17, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.25, 0.25, 0.25, 0.25, 0.0, 0.25, 0.25, 0.25, 0.25);
const vec2 PICTURE = vec2(2.5, 8.3);
const float SCREEN = 0.7853982;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 overprint(vec3 under, vec3 ink, float cover) {
  vec3 multiplied = under * mix(vec3(1.0), ink, cover);
  vec3 screened = 1.0 - (1.0 - under) * (1.0 - ink * cover);
  return mix(multiplied, screened, uDark);
}

// Sheet space to page coordinates: x 0..1 across the text measure, y in slots from the top line.
vec2 pageUv(vec2 q) {
  vec2 h = uSheet.zw;
  return vec2((q.x + h.x * 0.7) / (h.x * 1.4), (q.y + h.y * 0.7) / (h.y * 1.42 / float(SLOTS)));
}

// Lines of text: crisp bands (evaluated per pixel), so a line reads as a line, not a zig-zag.
float textLines(vec2 uv, float printed, float aaSlot, float aaX) {
  int slot = int(floor(uv.y));
  if (slot < 0 || slot >= SLOTS) return 0.0;
  float span = LINES[slot] * clamp(printed * float(SLOTS) - float(slot), 0.0, 1.0);
  if (span <= 0.0) return 0.0;
  float y = abs(fract(uv.y) - 0.5);
  float thick = HALF[slot];
  return smoothstep(thick + aaSlot, thick - aaSlot, y)
    * smoothstep(-aaX, aaX, uv.x) * smoothstep(span + aaX, span - aaX, uv.x);
}

// The picture: a hillside under a pale sun, as continuous tone (sampled at each dot's centre).
float picture(vec2 uv, float printed) {
  float v = (uv.y - PICTURE.x) / (PICTURE.y - PICTURE.x);
  if (uv.x < 0.0 || uv.x > 1.0 || v < 0.0 || v > 1.0) return 0.0;
  if (printed * float(SLOTS) < uv.y) return 0.0;
  float sky = mix(0.16, 0.4, v);
  float ridge = 0.58 + 0.1 * sin(uv.x * 5.2 + 0.8) + 0.05 * sin(uv.x * 13.0);
  float hill = smoothstep(ridge - 0.015, ridge + 0.015, v);
  float tone = mix(sky, 0.78 - 0.22 * uv.x + 0.08 * (v - ridge), hill);
  float sun = 1.0 - smoothstep(0.1, 0.13, length((vec2(uv.x, v) - vec2(0.72, 0.3)) * vec2(2.2, 1.0)));
  return clamp(mix(tone, 0.05, sun), 0.0, 1.0);
}

// Halftone coverage at a point in sheet space: one 45° dot screen shared by the lines (solid
// tone, clipped to the line) and the picture (dots sized by the tone at their centre).
float halftone(vec2 q, float printed, float gain) {
  vec2 s = rot(SCREEN) * q / uCell;
  vec2 id = floor(s) + 0.5;
  float aa = 0.7 * length(fwidth(s));
  vec2 uv = pageUv(q);
  vec2 duv = fwidth(uv);
  float lines = textLines(uv, printed, 0.75 * duv.y, 0.75 * duv.x);
  float pictureTone = picture(pageUv(rot(-SCREEN) * id * uCell), printed);
  float tone = max(lines * 0.66, pictureTone);
  if (tone <= 0.0) return 0.0;
  float r = lines > 0.0 ? sqrt(0.66 / 3.14159) : sqrt(pictureTone / 3.14159);
  float d = length(s - id) - min(0.5, r * gain);
  float disc = (1.0 - smoothstep(-aa, aa, d)) * max(lines, step(0.001, pictureTone));
  // Below about three device pixels a cell can't hold a crisp dot: show its average tone.
  return mix(tone, disc, smoothstep(2.4, 3.6, uCell * uDpr));
}

// Registration targets in the sheet's margins: a ring with a cross through it.
float targets(vec2 q) {
  vec2 h = uSheet.zw;
  float ring = 6.5;
  float arm = 12.0;
  float sd = 1e5;
  vec2 marks[4] = vec2[4](vec2(0.0, -h.y * 0.86), vec2(0.0, h.y * 0.86), vec2(-h.x * 0.86, 0.0), vec2(h.x * 0.86, 0.0));
  for (int i = 0; i < 4; i++) {
    vec2 d = q - marks[i];
    sd = min(sd, abs(length(d) - ring) - 0.55);
    sd = min(sd, max(abs(d.x) - 0.55, abs(d.y) - arm));
    sd = min(sd, max(abs(d.y) - 0.55, abs(d.x) - arm));
  }
  float aa = 0.75 / uDpr;
  return 1.0 - smoothstep(-aa, aa, sd);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 size = uRes / uDpr;
  float aa = 0.75 / uDpr;

  // Glass: light falls off from the middle of the pad; a fine cutting grid on top.
  vec2 fromCentre = (p - vec2(size.x * 0.54, size.y * 0.4)) / max(size.x, size.y);
  vec3 color = mix(uGlow, uGlass, smoothstep(0.0, 0.75, length(fromCentre)));
  vec2 cell = abs(fract(p / 24.0 + 0.5) - 0.5) * 24.0;
  vec2 major = abs(fract(p / 120.0 + 0.5) - 0.5) * 120.0;
  float fine = 1.0 - smoothstep(0.0, 1.0 / uDpr, min(cell.x, cell.y) - 0.5 / uDpr);
  float bold = 1.0 - smoothstep(0.0, 1.0 / uDpr, min(major.x, major.y) - 0.5 / uDpr);
  color = mix(color, uGrid, max(fine * 0.45, bold) * mix(0.16, 0.1, uDark));

  vec2 centre = uSheet.xy;
  vec2 halfSize = uSheet.zw;

  // The server's film: clear acetate with a faint edge.
  vec2 qf = p - centre;
  float filmSd = sdRoundRect(qf, halfSize, 5.0);
  float film = 1.0 - smoothstep(-aa, aa, filmSd);
  color = overprint(color, uFilmInk, film * 0.006);
  color = overprint(color, uFilmInk, film * halftone(qf, 1.0, 1.0) * 0.86);
  color = overprint(color, uFilmInk, film * targets(qf) * 0.9);
  color = overprint(color, uFilmInk, (1.0 - smoothstep(0.0, aa * 2.0, abs(filmSd))) * 0.35);

  // This device's copy: translucent paper, lifted while it is out of register.
  vec2 qm = rot(-uMine.z) * (p - centre - uMine.xy);
  float shadowSd = sdRoundRect(rot(-uMine.z) * (p - centre - uMine.xy - vec2(6.0, 14.0) * uLift), halfSize, 5.0);
  float shadow = (1.0 - smoothstep(-18.0, 26.0, shadowSd)) * uLift;
  color *= 1.0 - shadow * mix(0.06, 0.16, uDark);

  float mineSd = sdRoundRect(qm, halfSize, 5.0);
  float mine = 1.0 - smoothstep(-aa, aa, mineSd);
  color = mix(color, color * uPaper, mine * (1.0 - uDark));
  color = mix(color, color + uPaper * 0.06, mine * uDark);
  vec3 ink = mix(uInk, uWetInk, uWet);
  color = overprint(color, ink, mine * halftone(qm, uPrinted, 1.0 + 0.1 * uWet) * 0.95);
  color = overprint(color, ink, mine * targets(qm) * 0.95);
  color = overprint(color, ink, (1.0 - smoothstep(0.0, aa * 2.0, abs(mineSd))) * 0.3);

  outColor = vec4(color, 1.0);
}`;

const UNIFORMS = ['uRes', 'uDpr', 'uDark', 'uGlass', 'uGlow', 'uGrid', 'uFilmInk', 'uInk', 'uWetInk', 'uPaper', 'uSheet', 'uMine', 'uWet', 'uPrinted', 'uLift', 'uCell'];
const PALETTE = { glass: '--table-glass', glow: '--table-glow', grid: '--table-grid', filmInk: '--table-film-ink', ink: '--table-ink', wetInk: '--table-wet-ink', paper: '--table-paper' };

let probe = null;
/** Any CSS colour as linear-ish 0..1 RGB (the canvas reports colours as #rrggbb or rgba()). */
function parseColor(value) {
  probe ??= document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#000';
  probe.fillStyle = value.trim();
  const normal = probe.fillStyle;
  if (normal.startsWith('#')) return [1, 3, 5].map((i) => parseInt(normal.slice(i, i + 2), 16) / 255);
  const parts = normal.match(/[\d.]+/g) ?? ['0', '0', '0'];
  return parts.slice(0, 3).map((part) => Number(part) / 255);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader did not compile');
  return shader;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ reducedMotion: boolean, onLost?: () => void }} options
 * @returns {null | ReturnType<typeof engine>} null when WebGL 2 is unavailable.
 */
export function createRegistrationTable(canvas, options) {
  let gl;
  try {
    gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  try {
    return engine(canvas, gl, options);
  } catch (error) {
    console.warn('SyncSpace: the sign-in illustration could not start.', error);
    return null;
  }
}

function engine(canvas, gl, { reducedMotion, onLost }) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader did not link');
  const vao = gl.createVertexArray();
  const at = Object.fromEntries(UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]));

  let calm = reducedMotion;
  let palette = null;
  let dark = 0;
  let layout = { cx: 0, cy: 0, hw: 1, hh: 1, scale: 1 };
  let layoutInput = { reserveBottom: 0, compact: false };
  let size = { width: 1, height: 1 };
  let pose = { x: 0, y: 0, angle: 0, wet: 1, printed: 1, lift: 1 };
  let pointer = { x: 0, y: 0 };
  const start = calm ? null : ENTRANCE;
  const springs = {
    x: createSpring(start?.x ?? 0),
    y: createSpring(start?.y ?? 0),
    angle: createSpring(start?.angle ?? 0),
    wet: createSpring(1),
    printed: createSpring(1),
    lift: createSpring(1),
  };
  let frame = 0;
  let drawn = 0;
  let last = 0;
  let destroyed = false;

  function readPalette() {
    const style = getComputedStyle(canvas);
    palette = Object.fromEntries(Object.entries(PALETTE).map(([key, property]) => [key, parseColor(style.getPropertyValue(property) || '#808080')]));
    dark = document.documentElement.dataset.theme === 'dark' ? 1 : 0;
  }

  function aim() {
    const free = !calm && pose.lift > 0;
    springs.x.target = pose.x + (free ? pointer.x * 7 : 0);
    springs.y.target = pose.y + (free ? pointer.y * 5 : 0);
    springs.angle.target = pose.angle + (free ? pointer.x * 0.009 : 0);
    springs.wet.target = pose.wet;
    springs.printed.target = pose.printed;
    springs.lift.target = pose.lift;
    if (calm) for (const spring of Object.values(springs)) Object.assign(spring, { value: spring.target, velocity: 0 });
  }

  function draw() {
    if (destroyed || gl.isContextLost()) return;
    const { width, height } = size;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(at.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(at.uDpr, gl.drawingBufferWidth / width);
    gl.uniform1f(at.uDark, dark);
    gl.uniform3fv(at.uGlass, palette.glass);
    gl.uniform3fv(at.uGlow, palette.glow);
    gl.uniform3fv(at.uGrid, palette.grid);
    gl.uniform3fv(at.uFilmInk, palette.filmInk);
    gl.uniform3fv(at.uInk, palette.ink);
    gl.uniform3fv(at.uWetInk, palette.wetInk);
    gl.uniform3fv(at.uPaper, palette.paper);
    gl.uniform4f(at.uSheet, layout.cx, layout.cy, layout.hw, layout.hh);
    gl.uniform3f(at.uMine, springs.x.value * layout.scale, springs.y.value * layout.scale, springs.angle.value);
    gl.uniform1f(at.uWet, Math.min(1, Math.max(0, springs.wet.value)));
    gl.uniform1f(at.uPrinted, Math.min(1, Math.max(0, springs.printed.value)));
    gl.uniform1f(at.uLift, Math.max(0, springs.lift.value));
    gl.uniform1f(at.uCell, layout.hw < 110 ? 4.5 : height < 400 && width < 700 ? 5 : 6);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Read by the end-to-end tests: a settled table draws nothing.
    drawn += 1;
    canvas.dataset.frames = String(drawn);
  }

  function tick(now) {
    frame = 0;
    const dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    let moving = false;
    for (const spring of Object.values(springs)) {
      stepSpring(spring, dt);
      if (springSettled(spring)) Object.assign(spring, { value: spring.target, velocity: 0 });
      else moving = true;
    }
    draw();
    if (moving) frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (destroyed) return;
    if (calm) {
      draw();
      return;
    }
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    layout = sheetLayout({ width: size.width, height: size.height, ...layoutInput });
    draw();
  }

  const lost = (event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    onLost?.();
  };
  canvas.addEventListener('webglcontextlost', lost);

  readPalette();
  resize();

  return {
    /** The pose to settle into; `jolt` kicks the sheet back out as a failed attempt. */
    setPose(next, { jolt = false } = {}) {
      pose = next;
      aim();
      if (jolt && !calm) {
        springs.x.velocity += 260;
        springs.angle.velocity -= 0.5;
      }
      wake();
    },
    /** Pointer position over the table, -1..1 on each axis (0, 0 when it leaves). */
    setPointer(x, y) {
      pointer = { x, y };
      aim();
      wake();
    },
    setLayout(input) {
      layoutInput = input;
      resize();
    },
    setReducedMotion(value) {
      calm = value;
      if (calm) pointer = { x: 0, y: 0 };
      aim();
      wake();
    },
    refreshPalette() {
      readPalette();
      draw();
    },
    resize,
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', lost);
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
    },
  };
}
