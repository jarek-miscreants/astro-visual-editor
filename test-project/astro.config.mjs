import { defineConfig } from 'astro/config';

// Tailwind v4 is wired via PostCSS (see postcss.config.mjs) rather than
// the @tailwindcss/vite plugin, which is currently incompatible with
// Astro 6's rolldown-vite. global.css does `@import "tailwindcss";`.
export default defineConfig({});
