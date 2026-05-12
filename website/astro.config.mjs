import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://newtype-ai.org',
  integrations: [
    sitemap({
      filter: (page) => !page.endsWith('/explorer/') && !page.endsWith('/explorer'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  output: 'static'
});
