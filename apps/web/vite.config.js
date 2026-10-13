import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const apiTarget = process.env.SYNCSPACE_API ?? 'http://localhost:4000';

export default defineConfig({
  resolve: {
    // React Three Fiber imports 'three'; the landing page renders with three's WebGPU build, so
    // point that import there too instead of bundling the classic WebGLRenderer alongside it.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The service worker exists so the app shell (HTML, JS, CSS, fonts) loads without a
      // network. Document data never goes through it: that lives in IndexedDB.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'SyncSpace',
        short_name: 'SyncSpace',
        description: 'Shared documents that keep working offline.',
        theme_color: '#4B3FC4',
        background_color: '#E6E4EC',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}', 'assets/*-latin-*.woff2', 'assets/*-latin-ext-*.woff2'],
        // The landing page's 3D table (about 360 KB gzip) is not part of the offline app shell: it
        // downloads only when a visitor reaches the landing page, and is cached from then on.
        globIgnores: ['**/LightTable-*.js', '**/SplineDesk-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'syncspace-fonts', expiration: { maxEntries: 40 } },
          },
          {
            urlPattern: ({ url }) => /^\/assets\/(LightTable|SplineDesk)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'syncspace-landing-3d', expiration: { maxEntries: 4 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // The editor route is lazy-loaded; pre-bundle its dependencies at startup so the dev server
  // doesn't re-optimise (and invalidate in-flight modules) the first time a document opens.
  optimizeDeps: {
    include: [
      '@tiptap/react',
      '@tiptap/core',
      '@tiptap/pm/state',
      '@tiptap/pm/view',
      '@tiptap/starter-kit',
      '@tiptap/extensions',
      '@tiptap/extension-list',
      '@tiptap/extension-document',
      '@tiptap/extension-collaboration',
      '@tiptap/extension-collaboration-caret',
      '@tiptap/y-tiptap',
      'yjs',
      'y-protocols/awareness',
      'lib0/encoding',
      'lib0/decoding',
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    warmup: { clientFiles: ['./src/features/documents/DocumentPage.jsx', './src/features/auth/ReplicaDemo.jsx'] },
    proxy: {
      '/api': { target: apiTarget },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget },
      '/ws': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
