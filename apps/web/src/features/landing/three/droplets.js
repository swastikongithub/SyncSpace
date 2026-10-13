// Ink in transit. When a copy reconnects, its unsent rows leave it as droplets, land on the
// server's film (the moment the server stores them, and the moment the sender's wet ink dries),
// then hop to the other copies, which print the rows as the droplets arrive. A second, smaller
// flow carries the server's newer rows back to the reconnecting copy.
//
// Each droplet is simulated on the GPU every frame in a TSL compute shader: its velocity is
// integrated under a pull towards a target that moves with the sheets, drag, and swirling
// turbulence, so the droplets follow the copies as they settle rather than replaying a fixed path.
// On the WebGPU backend this is a compute pass over storage buffers; on the WebGL 2 fallback
// three.js runs the same shader through transform feedback, with fewer droplets.
import {
  clamp,
  cos,
  float,
  Fn,
  hash,
  If,
  instancedArray,
  instanceIndex,
  int,
  max,
  mix,
  select,
  shapeCircle,
  sin,
  smoothstep,
  uniform,
  uniformArray,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { Color, Matrix4, Sprite, SpriteNodeMaterial, Vector4 } from 'three/webgpu';
import { CONTENT } from '../animator.js';
import { TIMING } from '../choreography.js';

const MAX_SOURCE_ROWS = 4;

/** Seconds from the start of a flow. Landings use the choreography's TIMING, so rows print as droplets land. */
export const FLOW = { ...TIMING, launchSpread: 0.45, returnStart: 0.55, end: TIMING.toCopies + 0.3 };

export function createDroplets(count) {
  const position = instancedArray(count, 'vec3');
  const velocity = instancedArray(count, 'vec3');
  const colour = instancedArray(count, 'vec4');
  const phase = instancedArray(count, 'float');

  const row = () => new Vector4(0, 0, 0, 0);
  const u = {
    time: uniform(-1),
    dt: uniform(1 / 60),
    source: uniform(new Matrix4()),
    server: uniform(new Matrix4()),
    copyA: uniform(new Matrix4()),
    copyB: uniform(new Matrix4()),
    sourceRows: uniformArray(Array.from({ length: MAX_SOURCE_ROWS }, row)),
    sourceRowCount: uniform(0, 'int'),
    returnRows: uniformArray(Array.from({ length: MAX_SOURCE_ROWS }, row)),
    returnRowCount: uniform(0, 'int'),
    wetInk: uniform(new Color('#7b6fe8')),
    serverInk: uniform(new Color('#3b3650')),
    inkA: uniform(new Color('#a42a4b')),
    inkB: uniform(new Color('#1d5fa8')),
    size: uniform(0.0064),
  };

  const seed = (n) => hash(instanceIndex.add(n * 7919));

  /** A point on one of the given rows, in a sheet's content frame. */
  const rowPoint = (rows, rowCount, s1, s2, s3) => {
    const index = clamp(int(s1.mul(float(rowCount))), int(0), max(rowCount.sub(1), int(0)));
    const r = rows.element(index);
    return vec4(float(CONTENT.left).add(s2.mul(r.z)), r.x.add(s3.sub(0.5).mul(2).mul(r.y)), 0, 1);
  };

  const update = Fn(() => {
    const p = position.element(instanceIndex);
    const v = velocity.element(instanceIndex);
    const c = colour.element(instanceIndex);
    const last = phase.element(instanceIndex);

    const returning = seed(1).lessThan(0.22).and(u.returnRowCount.greaterThan(0));
    const toB = seed(2).lessThan(0.5);
    const delay = seed(3).mul(FLOW.launchSpread);
    const t = u.time;

    const local = select(
      returning,
      rowPoint(u.returnRows, u.returnRowCount, seed(4), seed(5), seed(6)),
      rowPoint(u.sourceRows, u.sourceRowCount, seed(4), seed(5), seed(6)),
    );
    const atSource = u.source.mul(local).xyz;
    const atServer = u.server.mul(local).xyz;
    const atCopy = select(toB, u.copyB.mul(local).xyz, u.copyA.mul(local).xyz);
    const copyInk = select(toB, u.inkB, u.inkA);

    // Phase: 0 waiting, 1 to the server, 2 to a copy, 3 back to the source (returning flow), 4 done.
    const start = select(returning, delay.mul(0.5).add(FLOW.returnStart), delay);
    const target = vec3(0).toVar();
    const ink = vec3(u.wetInk).toVar();
    const from = float(0).toVar();
    const until = float(1).toVar();
    const current = float(0).toVar();
    If(t.lessThan(0).or(u.sourceRowCount.equal(0)), () => {
      current.assign(4);
    })
      .ElseIf(t.lessThan(start), () => {
        current.assign(0);
      })
      .ElseIf(returning, () => {
        If(t.lessThan(FLOW.fromServer), () => {
          current.assign(3);
          target.assign(atSource);
          ink.assign(u.inkA);
          from.assign(start);
          until.assign(FLOW.fromServer);
        }).Else(() => {
          current.assign(4);
        });
      })
      .ElseIf(t.lessThan(FLOW.toServer), () => {
        current.assign(1);
        target.assign(atServer);
        from.assign(start);
        until.assign(FLOW.toServer);
      })
      .ElseIf(t.lessThan(FLOW.toCopies), () => {
        current.assign(2);
        target.assign(atCopy);
        ink.assign(copyInk);
        from.assign(FLOW.toServer + 0.05);
        until.assign(FLOW.toCopies);
      })
      .Else(() => {
        current.assign(4);
      });

    // Entering a new leg: start from where that leg begins, with a small kick upwards.
    If(current.notEqual(last), () => {
      If(current.equal(1), () => {
        p.assign(atSource);
      });
      If(current.equal(2).or(current.equal(3)), () => {
        p.assign(atServer);
      });
      v.assign(vec3(seed(7).sub(0.5).mul(1.1), seed(8).mul(0.9).add(0.7), seed(9).sub(0.5).mul(1.1)));
      last.assign(current);
    });

    If(current.greaterThan(0).and(current.lessThan(4)), () => {
      const progress = clamp(t.sub(from).div(until.sub(from)), 0, 1);
      const dt = u.dt;
      // Droplets arc between sheets rather than sliding along them; hops to copies arc higher.
      const arc = sin(progress.mul(Math.PI)).mul(select(current.equal(1), float(0.07), float(0.16)));
      // The two receiving copies' droplets leave in two plumes, one to each side.
      const side = select(current.equal(2), select(toB, float(-0.45), float(0.45)), float(0));
      const aim = target.add(vec3(side.mul(arc), arc, 0));
      // Swirl that fades as the droplet nears its landing.
      const swirl = vec3(
        sin(p.z.mul(17).add(t.mul(3.1)).add(seed(10).mul(6.28))),
        cos(p.x.mul(13).add(t.mul(2.3))).mul(0.6),
        sin(p.x.mul(11).add(p.y.mul(19)).add(t.mul(2.7))),
      ).mul(float(1).sub(progress).mul(1.5));
      const pull = aim.sub(p).mul(mix(float(9), float(60), progress));
      v.assign(v.add(pull.add(swirl).mul(dt)).mul(float(1).sub(dt.mul(4.5))));
      p.addAssign(v.mul(dt));
      // Land on time whatever the simulation did: the rows print at these moments.
      p.assign(mix(p, target, smoothstep(0.82, 1, progress)));
      const alpha = smoothstep(0, 0.08, progress).mul(float(1).sub(smoothstep(0.93, 1, progress))).mul(0.85);
      c.assign(vec4(ink, alpha));
    }).Else(() => {
      c.assign(vec4(ink, 0));
    });
  })().compute(count);

  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  material.positionNode = position.toAttribute();
  // Read per droplet in the vertex stage and handed to the fragment stage explicitly: the WebGL 2
  // backend cannot read an instanced storage attribute from a fragment shader.
  const tint = varying(colour.toAttribute());
  material.colorNode = tint.xyz;
  material.opacityNode = tint.w.mul(shapeCircle());
  material.scaleNode = u.size.mul(hash(instanceIndex).mul(0.75).add(0.5));

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;
  sprite.visible = false;

  return {
    sprite,
    buffers: { position, colour, phase },
    uniforms: u,
    update,
    setRows(target, rows) {
      const list = target === 'return' ? u.returnRows : u.sourceRows;
      rows.slice(0, MAX_SOURCE_ROWS).forEach((r, index) => list.array[index].set(r.y, r.halfHeight, r.length, 0));
      (target === 'return' ? u.returnRowCount : u.sourceRowCount).value = Math.min(rows.length, MAX_SOURCE_ROWS);
    },
    dispose() {
      material.dispose();
      sprite.geometry?.dispose();
    },
  };
}
