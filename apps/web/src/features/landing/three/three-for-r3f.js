// What `import ... from 'three'` resolves to (vite.config.js alias): three's WebGPU build, which
// the light table renders with. React Three Fiber also references WebGLRenderer, for when no
// renderer factory is given; the light table always gives one, so that path is never taken.
// Naming it here keeps the build free of a missing-export warning and fails loudly if it ever is.
export * from 'three/webgpu';

export class WebGLRenderer {
  constructor() {
    throw new Error('The landing page renders with WebGPURenderer; pass a renderer factory to <Canvas gl>.');
  }
}
