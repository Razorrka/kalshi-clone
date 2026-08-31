/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the project site from /<repo>/, so assets need that
// prefix. Override with VITE_BASE=/ for a root deploy or a custom domain.
const base = process.env.VITE_BASE ?? '/kalshi-clone/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { host: true, port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
