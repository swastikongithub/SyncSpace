// The light table: a React Three Fiber canvas on three.js's WebGPURenderer. WebGPU is used where
// the browser grants an adapter; otherwise the same renderer runs its WebGL 2 backend, compiling
// the same TSL materials to GLSL. If neither starts, the error reaches StageFrame's boundary and
// the SVG poster stays in place. Loaded lazily: none of this is in the app's main bundle.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { PCFShadowMap, WebGPURenderer } from 'three/webgpu';
import { currentTheme, onThemeChange } from '../../../app/theme.js';
import { LightTableEngine } from './engine.js';

function readColours() {
  const style = getComputedStyle(document.documentElement);
  const dark = currentTheme() === 'dark';
  const surround = style.getPropertyValue('--desk').trim() || (dark ? '#14121c' : '#e6e4ec');
  return dark
    ? { surround, spill: '#3b3656', spillStrength: 0.75, glow: '#ebe8f4', grid: '#cfcadf', bezel: '#46415e', metal: '#4a4562' }
    : { surround, spill: '#f6f5fb', spillStrength: 0.6, glow: '#fdfcff', grid: '#dedaeb', bezel: '#d3d0dd', metal: '#aaa6b9' };
}

const debug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('stage-debug');

function TableScene({ store, activeRef, motionRef, onFrame, pitch, framing }) {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const gl = useThree((state) => state.gl);
  const engine = useMemo(() => new LightTableEngine(gl, { pitch, framing }), [gl, pitch, framing]);

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    if (import.meta.env.DEV) window.__lightTable = engine;
  }, [engine]);

  // Page colours (the theme the person chose, or the system's) around the pad.
  useEffect(() => {
    const apply = () => {
      engine.setColours(readColours());
      if (activeRef.current) invalidate();
    };
    apply();
    return onThemeChange(apply);
  }, [engine, invalidate, activeRef]);

  // Follow the story. Off screen, the change is recorded but not drawn: StageFrame asks for a
  // frame when the stage comes back into view.
  useEffect(() => {
    engine.show(store.get(), { motion: motionRef.current });
    invalidate();
    return store.subscribe((state) => {
      engine.show(state, { motion: motionRef.current });
      if (activeRef.current) invalidate();
    });
  }, [engine, store, invalidate, motionRef, activeRef]);

  // A fine pointer (mouse or pen) tilts the view a little, and in the opening chapter can drag your
  // copy out of register; let go and it settles back. Touch scrolls the page instead. The same
  // action is available to everyone through the "Pull my copy out of register" button.
  useEffect(() => {
    const element = gl.domElement;
    const fine = window.matchMedia('(pointer: fine)');
    let dragging = null;
    const position = (event) => {
      const rect = element.getBoundingClientRect();
      return [((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1];
    };
    const allowed = (event) => event.pointerType !== 'touch' && fine.matches && motionRef.current;

    const down = (event) => {
      if (!allowed(event) || store.get().chapter !== 'hero') return;
      if (!engine.startDrag(camera, ...position(event))) return;
      dragging = event.pointerId;
      element.setPointerCapture(event.pointerId);
      element.style.cursor = 'grabbing';
      invalidate();
    };
    const move = (event) => {
      if (!allowed(event)) return;
      const [x, y] = position(event);
      if (dragging === event.pointerId) engine.moveDrag(camera, x, y);
      else if (store.get().chapter === 'hero') element.style.cursor = engine.overYourCopy(camera, x, y) ? 'grab' : '';
      engine.setPointer(x, -y);
      invalidate();
    };
    const release = (event) => {
      if (dragging !== event.pointerId) return;
      dragging = null;
      element.style.cursor = '';
      engine.endDrag(store.get());
      invalidate();
    };
    const leave = () => {
      engine.setPointer(0, 0);
      invalidate();
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', leave);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('pointerleave', leave);
    };
  }, [engine, gl, camera, store, invalidate, motionRef]);

  useFrame((_, delta) => {
    const more = engine.frame(camera, size, delta);
    onFrame?.(debug ? engine.diagnose(size) : null);
    if (more && activeRef.current) invalidate();
  });

  return <primitive object={engine.root} />;
}

/**
 * @param {object} props
 * @param {ReturnType<import('../stage-store.js').createStageStore>} props.store
 * @param {boolean} props.forceWebGL   skip WebGPU (?renderer=webgl, for comparison and testing)
 * @param {{ current: boolean }} props.activeRef  false while the stage is off screen: no frames
 * @param {{ current: boolean }} props.motionRef  false when reduced motion is preferred
 * @param {(backend: 'webgpu' | 'webgl2', state: object) => void} props.onReady
 * @param {() => void} props.onFrame
 * @param {number} props.maxDpr
 * @param {number} props.pitch  halftone screen pitch (coarser on small screens)
 * @param {'pad' | 'sheets'} props.framing  frame the whole pad, or just the sheets (small screens)
 */
export default function LightTable({ store, forceWebGL, activeRef, motionRef, onReady, onFrame, maxDpr, pitch, framing }) {
  return (
    <Canvas
      frameloop="demand"
      // Pointer positions are computed from the canvas's own rectangle (see TableScene), so R3F
      // need not re-measure on scroll, which would draw a frame each time the page scrolls.
      resize={{ scroll: false }}
      flat
      // No shadow maps (the sheets' shadows are drawn by their own material). Passing the type
      // keeps R3F from selecting PCFSoftShadowMap, which the WebGPU renderer no longer has.
      shadows={{ enabled: false, type: PCFShadowMap }}
      dpr={[1, maxDpr]}
      camera={{ fov: 30, near: 0.05, far: 40, position: [0, 3, 2.4] }}
      gl={async (props) => {
        // R3F suggests high-performance; WebGPU ignores the hint on Windows and warns, so leave it unset.
        const renderer = new WebGPURenderer({ ...props, antialias: true, alpha: true, forceWebGL, powerPreference: undefined });
        await renderer.init();
        return renderer;
      }}
      onCreated={(state) => {
        state.gl.setClearColor(0x000000, 0);
        onReady(state.gl.backend.isWebGPUBackend ? 'webgpu' : 'webgl2', state);
      }}
      style={{ touchAction: 'pan-y' }}
    >
      <TableScene store={store} activeRef={activeRef} motionRef={motionRef} onFrame={onFrame} pitch={pitch} framing={framing} />
    </Canvas>
  );
}
