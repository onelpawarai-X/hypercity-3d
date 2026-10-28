import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the same build works at the domain root, on GitHub Pages
  // under /<repo>/, and from a local file server, with no rebuild per host.
  base: './',
  server: {
    host: '0.0.0.0',
    port: 12000,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // The training relay listens on 12001; proxying it through the dev
      // server puts it on the same origin, so it also works over an HTTPS
      // tunnel (where a direct ws://host:12001 would be mixed content).
      '/relay': {
        target: 'ws://localhost:12001',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 12000,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 4096,
  },
});
