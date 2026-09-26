import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
    ],
    define: {
      '__JARVIS_BUILD_TIME__': JSON.stringify(new Date().toISOString()),
      '__JARVIS_COMMIT_SHA__': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '1d3ff5f'),
      '__JARVIS_ENV__': JSON.stringify(mode || 'production'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'client'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/leads.json'],
      },
    },
  };
});
