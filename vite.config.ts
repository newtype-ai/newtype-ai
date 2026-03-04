import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const entry = process.env.VITE_ENTRY || 'badge';

const configs: Record<string, {
  root: string;
  input: string;
  filename: string;
  emptyOutDir: boolean;
}> = {
  badge: {
    root: 'badge',
    input: 'badge/src/main.tsx',
    filename: 'badge.js',
    emptyOutDir: true,
  },
  card: {
    root: 'card',
    input: 'card/src/main.tsx',
    filename: 'card.js',
    emptyOutDir: false, // don't delete badge.js
  },
};

const cfg = configs[entry] ?? configs.badge;

export default defineConfig({
  root: cfg.root,
  build: {
    outDir: '../public/assets',
    emptyOutDir: cfg.emptyOutDir,
    rollupOptions: {
      input: cfg.input,
      output: {
        entryFileNames: cfg.filename,
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
  plugins: [react()],
});
