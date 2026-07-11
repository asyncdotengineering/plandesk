import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// Dev proxy target for /api + /mcp: PLANDESK_DEV_API env → the workspace's bound
// Plan Desk server (../../.plandesk/config.json serverUrl) → legacy default.
// Lets `pnpm dev` hit your running server without editing this file.
function devApiTarget(): string {
  if (process.env.PLANDESK_DEV_API) return process.env.PLANDESK_DEV_API;
  try {
    const cfg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../.plandesk/config.json', import.meta.url)),
        'utf8',
      ),
    ) as { serverUrl?: string };
    if (typeof cfg.serverUrl === 'string' && cfg.serverUrl !== '') {
      return cfg.serverUrl;
    }
  } catch {
    // no bound config — fall through to the default
  }
  return 'http://127.0.0.1:3847';
}

const apiTarget = devApiTarget();

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    tanstackRouter({
      target: 'react',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/mcp': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
