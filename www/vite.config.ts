import { fileURLToPath } from 'node:url';
import devServer from '@hono/vite-dev-server';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { staticPages } from './build/static-pages.ts';

// One build for every platform: `vite build` emits the static SPA into dist/, and each platform runs the
// API (server/app.ts) through its own entry (server/worker.ts, api/index.ts, netlify/functions/api.mts).
export default defineConfig(({ mode }) => {
  // The dev server runs the API in Node; give it the variables from .env files (ADMIN_TOKEN,
  // GITHUB_TOKEN, ...) the way the platforms provide their environment variables
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    appType: 'mpa', // Only known routes get the SPA shell; other paths return 404.
    plugins: [
      react(),
      tailwindcss(),
      // Serves /api/* from Hono; staticPages handles known pages and the 404 response.
      devServer({ entry: 'server/app.ts', exclude: [/^(?!\/api(\/|$)).*/] }),
      staticPages(),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  };
});
