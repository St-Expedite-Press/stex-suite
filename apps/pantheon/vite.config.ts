/** Pantheon production build configuration for the website workspace and its served asset names. */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/workspaces',
    lib: { entry: 'workspaces/seaxneat/main.tsx', formats: ['es'], /** Selects the stable output filename for the workspace bundle. */ fileName: () => 'seaxneat.js', cssFileName: 'seaxneat' },
  },
});
