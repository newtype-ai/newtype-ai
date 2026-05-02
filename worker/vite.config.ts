import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const entry = process.env.VITE_ENTRY || 'all';

const configs: Record<string, {
  root: string;
  input: string | Record<string, string>;
  entryFileNames: string;
  outDir: string;
  emptyOutDir: boolean;
}> = {
  all: {
    root: '.',
    input: {
      badge: 'badge/src/main.tsx',
      card: 'card/src/main.tsx',
    },
    entryFileNames: '[name].js',
    outDir: 'public/assets',
    emptyOutDir: true,
  },
  badge: {
    root: 'badge',
    input: 'badge/src/main.tsx',
    entryFileNames: 'badge.js',
    outDir: '../public/assets',
    emptyOutDir: true,
  },
  card: {
    root: 'card',
    input: 'card/src/main.tsx',
    entryFileNames: 'card.js',
    outDir: '../public/assets',
    emptyOutDir: false, // don't delete badge.js
  },
};

const cfg = configs[entry] ?? configs.badge;

export default defineConfig({
  root: cfg.root,
  publicDir: false,
  build: {
    outDir: cfg.outDir,
    emptyOutDir: cfg.emptyOutDir,
    rollupOptions: {
      input: cfg.input,
      output: {
        entryFileNames: cfg.entryFileNames,
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'react';
          }
          if (id.includes('/three/')) return 'three';
          if (id.includes('/@react-three/fiber/')) return 'fiber';
          return 'vendor';
        },
      },
    },
  },
  plugins: [react()],
});
