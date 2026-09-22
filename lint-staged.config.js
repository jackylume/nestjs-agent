export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}': [
    'oxfmt --write --no-error-on-unmatched-pattern',
    'oxlint --deny-warnings',
  ],
  '*.{json,jsonc,yaml,yml,md,mdx,html,css,scss}': 'oxfmt --write --no-error-on-unmatched-pattern',
};
