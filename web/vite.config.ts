import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GOTCHA (Task 11): dev server proxia /api para o server Fastify em :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
