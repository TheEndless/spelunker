import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // The Rust build output (tens of gigabytes), local snapshots and working folders hold nothing
    // the page imports, and watching them makes the dev server slow to answer its first request.
    watch: { ignored: ['**/target/**', '**/.snapshots/**', '**/.superpowers/**', '**/installers/**', '**/dist/**'] },
  },
  // Without this, Vite scans every html file under the project for dependencies, including stray
  // ones in the Rust build output and in snapshots, before it serves the first request.
  optimizeDeps: { entries: ['index.html'] },
  test: { include: ['src/**/*.test.ts'] },
});
