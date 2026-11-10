import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://harness.jgonaz.dev',
  // Castellano en la raíz e inglés bajo /en, igual que el README y su traducción.
  i18n: {
    defaultLocale: 'es',
    locales: ['es', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
