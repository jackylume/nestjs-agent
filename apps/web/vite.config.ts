import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { lazyPlugins } from 'vite-plus';
import { defineConfig } from 'vite-plus';

export default defineConfig(() => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));

  return {
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    envDir,
    test: {
      include: ['tests/**/*.{test,spec}.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      clearMocks: true,
      restoreMocks: true,
      unstubGlobals: true,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
  };
});
