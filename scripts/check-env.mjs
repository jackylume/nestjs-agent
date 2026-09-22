import { readFileSync } from 'node:fs';

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageManager = process.env.npm_config_user_agent?.split(' ')[0];

if (process.versions.node !== engines.node || packageManager !== `pnpm/${engines.pnpm}`) {
  console.error(`请使用 Node.js ${engines.node} 和 pnpm ${engines.pnpm} 安装依赖。`);
  process.exit(1);
}
