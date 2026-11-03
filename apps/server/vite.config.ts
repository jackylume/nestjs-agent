import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/main.ts'],
    tsconfig: './tsconfig.json',
    target: 'node22',
    format: 'esm',
    fixedExtension: false,
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.{test,spec}.ts'],
  },
});
