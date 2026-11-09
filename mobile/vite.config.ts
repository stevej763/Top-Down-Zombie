import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the native WebViews serve dist/ from their own root.
  base: './',
  // The soundtrack lives with the web client.
  publicDir: '../client/public',
  server: {
    port: 5175,
    // Reachable from a phone on the same network.
    host: true,
    open: false,
    // The game itself is imported from ../client/src (and ../shared/defs).
    fs: { allow: ['..'] },
    // Same as the web client: a local bootRun, or API_TARGET=http://localhost:8551 for compose.
    proxy: {
      '/api': process.env.API_TARGET ?? 'http://localhost:8080',
      '/ws': { target: (process.env.API_TARGET ?? 'http://localhost:8080').replace(/^http/, 'ws'), ws: true },
    },
  },
});
