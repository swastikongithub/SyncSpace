// Where the camera looks from for each part of the story, framed so the stack of copies fits the
// stage at any aspect ratio. Moves on the same critically damped springs as the copies.
import { channel, retarget, settleNow, springStep } from '../animator.js';

const DEG = Math.PI / 180;

export const CAMERA_PRESETS = {
  hero: { elevation: 57, yaw: -15, reach: 1, tx: 0.01, ty: 0, tz: 0.01 },
  offline: { elevation: 46, yaw: -21, reach: 1.03, tx: 0.03, ty: 0.05, tz: 0 },
  stored: { elevation: 53, yaw: -13, reach: 1, tx: 0, ty: 0, tz: 0 },
  history: { elevation: 63, yaw: -9, reach: 0.98, tx: 0, ty: 0, tz: 0 },
  try: { elevation: 61, yaw: -9, reach: 0.98, tx: 0.02, ty: 0, tz: 0 },
};

const FIELDS = ['elevation', 'yaw', 'reach', 'tx', 'ty', 'tz', 'px', 'py'];

export class CameraRig {
  /** @param {number} radius  the part of the scene that must fit: the whole pad (1.2), or just the sheets (0.95) */
  constructor(radius = 1.2) {
    this.radius = radius;
    this.channels = Object.fromEntries(FIELDS.map((field) => [field, channel(0, field === 'px' || field === 'py' ? 4 : 3.2)]));
    this.setPreset('hero', true);
  }

  setPreset(name, instant) {
    const preset = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.hero;
    for (const [field, value] of Object.entries(preset)) {
      retarget(this.channels[field], value, 0);
      if (instant) settleNow(this.channels[field]);
    }
  }

  /** Positions the camera; returns true while it is still moving. */
  step(camera, size, pointer, dt) {
    const c = this.channels;
    retarget(c.px, pointer.x, 0);
    retarget(c.py, pointer.y, 0);
    let moving = false;
    for (const field of FIELDS) moving = springStep(c[field], dt, 0) || moving;

    const aspect = size.width / Math.max(1, size.height);
    const halfV = (camera.fov * DEG) / 2;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const distance = (this.radius / Math.sin(Math.min(halfV, halfH))) * c.reach.value;

    const elevation = (c.elevation.value - c.py.value * 2.2) * DEG;
    const yaw = (c.yaw.value + c.px.value * 3.5) * DEG;
    camera.position.set(
      c.tx.value + distance * Math.cos(elevation) * Math.sin(yaw),
      c.ty.value + distance * Math.sin(elevation),
      c.tz.value + distance * Math.cos(elevation) * Math.cos(yaw),
    );
    camera.lookAt(c.tx.value, c.ty.value, c.tz.value);
    return moving;
  }
}
