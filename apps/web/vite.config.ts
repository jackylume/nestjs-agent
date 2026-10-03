import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv, lazyPlugins } from 'vite-plus';
import { defineConfig } from 'vite-plus';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, envDir, '');

  return {
    plugins: lazyPlugins(() => [react(), tailwindcss()]),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    envDir,
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      clearMocks: true,
      restoreMocks: true,
      unstubGlobals: true,
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${env.PORT || 3000}`,
      },
    },
  };
});
