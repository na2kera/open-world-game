import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes('/node_modules/three/')) {
            return 'three';
          }
          return undefined;
        },
      },
    },
  },
});
