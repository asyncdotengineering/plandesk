import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
    }),
    react(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
      },
      '/mcp': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
