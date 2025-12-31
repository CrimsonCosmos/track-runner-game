import { defineConfig } from 'vite';

export default defineConfig({
  // Clear build output directory
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    // Ensure assets are properly handled
    assetsDir: 'assets',
    // Copy models folder
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
  },

  // Development server
  server: {
    port: 5173,
    strictPort: true,
  },

  // Use local Three.js from node_modules
  resolve: {
    alias: {
      'three/addons/': 'three/examples/jsm/',
    },
  },

  // Public directory for static assets
  publicDir: 'public',
});
