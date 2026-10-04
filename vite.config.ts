import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
    semi: true,
    printWidth: 100,
    ignorePatterns: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/server/src/generated/prisma/**',
      'pnpm-lock.yaml',
    ],
  },
  lint: {
    plugins: ['typescript', 'react', 'jsx-a11y'],
    categories: {
      correctness: 'error',
    },
    ignorePatterns: ['**/dist/**', '**/node_modules/**', 'apps/server/src/generated/prisma/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
  },
  staged: {
    '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}': [
      'vp fmt --write --no-error-on-unmatched-pattern',
      'vp lint --deny-warnings',
    ],
    '*.{json,jsonc,yaml,yml,md,mdx,html,css,scss}':
      'vp fmt --write --no-error-on-unmatched-pattern',
  },
});
