import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: false,
    // The Spring Boot server (./gradlew :app:bootRun, or the compose `server` service).
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
