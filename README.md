# NestJS Agent

基于 pnpm workspace 的 TypeScript monorepo。React 负责前端，NestJS 提供 API，PostgreSQL 存储数据。

## 技术版本

版本于 2026-09-21 从 npm registry 和 Node.js 官方发行列表核实，依赖使用精确版本并由 `pnpm-lock.yaml` 锁定。

前端基建依赖于 2026-09-22 核实并接入：alova 3.5.5、React Router 8.4.0、Tailwind CSS 4.3.3、Ant Design 6.6.5、Vitest 5.0.1。

| 工具           | 版本                             |
| -------------- | -------------------------------- |
| Node.js        | 22.23.2（22 系列当前最新正式版） |
| pnpm           | 10.34.5（10 系列当前最新正式版） |
| TypeScript     | 7.0.2                            |
| Vite           | 8.3.0                            |
| React          | 19.3.0                           |
| NestJS         | 12.0.4                           |
| PostgreSQL     | 18.6（本地 Docker 镜像）         |
| Oxlint / Oxfmt | 1.85.0 / 0.70.0                  |

`mise.toml` 统一管理 Node.js、pnpm 的精确版本；`engines`、`.npmrc` 和安装前检查校验版本。今后更新补丁版本时须同步这些设置。

## 目录

```text
apps/
  web/          React 前端，Vite 开发服务器与生产构建
  server/       NestJS API，TypeScript 7 编译为 Node.js ESM
packages/
  shared/       前后端共享的 TypeScript 类型，只允许 import type
scripts/
  check-env.mjs Node.js / pnpm 版本检查
compose.yaml    本地 PostgreSQL
```

## 本地启动

需要安装 mise 并在当前 shell 中激活，以及已启动的 Docker（包含 Compose）。mise 会根据项目配置安装 Node.js 22.23.2 和 pnpm 10.34.5。也可以连接已有 PostgreSQL，此时跳过 `pnpm db:up` 并修改 `DATABASE_URL`。

```bash
mise trust
mise install
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm dev
```

如果尚未激活 mise，zsh 可先执行 `eval "$(mise activate zsh)"`；也可以通过 `mise exec -- pnpm <命令>` 使用项目指定的工具版本。

- 前端：<http://localhost:5173>
- 前端服务状态页：<http://localhost:5173/health>
- API 存活检查：<http://127.0.0.1:3000/api/health>
- 数据库连通检查：<http://127.0.0.1:3000/api/health/db>

前端通过 Vite 将 `/api` 代理到 NestJS。根目录 `.env` 中的 `PORT` 同时供前端代理和服务端读取，修改后重启开发命令。只有 `VITE_` 前缀变量会公开给浏览器，不要给数据库凭据添加此前缀。

数据库检查会执行 `SELECT 1`：成功返回 HTTP 200，数据库不可达时返回 HTTP 503。服务启动不要求数据库立即可达，但必须配置 `DATABASE_URL`。`pg` 连接池在服务关闭时释放；目前没有业务表或 ORM。

Compose 的默认账号和密码仅用于本地开发，端口仅绑定本机。修改账号、密码或数据库名时，也需同步 `DATABASE_URL`；已有数据卷不会因环境变量变化而重新初始化。`pnpm db:down` 停止数据库但保留数据卷。

## 常用命令

```bash
pnpm dev                         # 并行启动前后端，服务端修改后重新构建并重启
pnpm check                       # Oxlint、Oxfmt、TypeScript 检查及 Vitest 测试
pnpm test                        # 运行 workspace 中的测试
pnpm test:watch                  # 前端 Vitest 监听模式
pnpm format                      # Oxfmt 格式化
pnpm lint:fix                    # Oxlint 自动修复
pnpm build                       # 类型检查，前端使用 Vite 8，服务端使用 tsc 构建
pnpm --filter @nestjs-agent/server start
pnpm --filter @nestjs-agent/web preview
```

前端产物位于 `apps/web/dist`，服务端产物位于 `apps/server/dist`。服务端构建保留 npm 依赖为外部依赖，运行时仍需要安装 workspace 的依赖。生产环境需由 Web 服务器托管前端静态文件并将 `/api` 转发到 NestJS；非 API 的前端路由（如 `/health`）需回退到 `index.html`，保证直接访问和刷新可用。`vite preview` 仅用于静态产物预览，不提供这里的开发 API 代理。

## Turbo 任务编排

pnpm 负责依赖和 workspace 链接，Turbo 编排 `dev`、`build`、`typecheck`、`test` 与 `test:watch`；根目录 pnpm 命令入口保持一致。Oxlint、Oxfmt 继续全量执行。

- `build` 先完成当前包类型检查及依赖包构建，再缓存 `dist/**`。
- `typecheck` 按包依赖顺序执行；`test` 先完成类型检查。`shared` 虽然没有构建产物，其类型检查任务仍会将源码变化传递给前后端任务的缓存键。
- 根目录 `tsconfig.base.json`、`.env` / `.env.*` 与 `NODE_ENV`、`VITE_*`、`PORT` 参与缓存计算。Turbo 不负责加载 `.env`，仍由 Vite 与 Node 加载。
- `dev`、`test:watch` 是常驻任务，不缓存；`dev` 允许传入 shell 中的 `DATABASE_URL`。
- 默认使用本地 `.turbo` 缓存，不配置远程缓存。pre-push 仍检查全部包，输入未变时允许复用成功结果。

可用 `pnpm exec turbo run build --dry=json` 查看任务图，使用 `pnpm exec turbo run build --force` 强制重新执行。

## React 前端基建

```text
apps/web/src/
  app/             Ant Design 全局配置、路由定义和路由测试
  layouts/         公共布局与导航
  pages/           首页、服务状态、404、路由错误兜底
  features/health/  健康检查接口
  lib/http.ts      alova 请求实例与统一 HTTP 错误处理
  test/setup.ts    Vitest DOM 环境初始化
```

- 请求统一使用 `lib/http.ts` 导出的 alova 实例，API 前缀为 `/api`，超时 10 秒。非成功 HTTP 响应抛出带有 `status` 的 `ApiError`，兼容 NestJS 字符串 / 数组错误信息和非 JSON 错误页；204 响应返回 `undefined`。
- 业务接口按功能放在 `features` 中，组件使用 `alova/client` 的 `useRequest` 管理加载、数据和错误状态。健康检查配置 `cacheFor: 0`，每次重新检查都会访问服务端。共享类型提供编译期约束，不替代运行时数据校验。
- React Router 使用浏览器历史路由，首页和服务状态页按路由懒加载；路由统一定义在 `app/routes.tsx`，公共布局包含导航和加载状态。
- Tailwind CSS 通过 Vite 插件接入，负责布局、间距和自定义样式；Ant Design 负责交互组件，通过 `ConfigProvider` 设置中文和主题，通过 `App.useApp()` 获取后续业务需要的 message / notification / modal 实例。
- 全局 CSS 声明 `theme, base, antd, components, utilities` 的层级顺序，配合 `StyleProvider layer`，让 Tailwind 的重置样式与 Ant Design 组件样式正常共存。Ant Design 主题优先通过 token 调整。
- Vitest 使用 jsdom、React Testing Library 和 jest-dom。测试替换网络边界的 `fetch`，保留真实 alova 请求处理和页面逻辑；测试文件与对应代码相邻。`pnpm check` 包含测试，Git 推送前仍运行全项目类型检查。

## 编译约定

### 共享认证状态

前端使用 Zustand 的 `useAuthStore` 管理 Token，无需在入口添加 Provider。通过官方 `zustand/middleware` 的 `persist` 与 `createJSONStorage` 持久化到 `localStorage`，刷新或重新打开浏览器后可恢复；这里只保存访问 Token，恢复存储不代表 Token 仍有效，有效期由服务端校验。浏览器脚本可读取该存储，后续 refresh token 应交由服务端通过 HttpOnly Cookie 管理。

```tsx
import { useAuthStore } from '@/stores/auth';

// 组件订阅状态
const token = useAuthStore((state) => state.token);
// 登录成功后写入，退出时清除；组件外也可以调用
const { getToken, setToken, clearToken } = useAuthStore.getState();
setToken(accessToken);
getToken(); // 每次调用读取最新值，解构方法后也不会使用旧快照
clearToken();
```

alova 在每次发送请求前读取最新 Token，写入 `Authorization: Bearer <token>`；清除 Token 后不再携带该请求头。该实例用于项目 `/api` 接口。默认禁用 GET 响应缓存，避免切换账号后复用上一账号的数据；后续如为特定接口启用缓存，需要同时设计账号隔离。当前未实现登录接口、自动续期、401 跳转或后端鉴权。

### TypeScript 与构建

前端 TypeScript 按运行环境拆分：`tsconfig.app.json` 检查浏览器源码，`tsconfig.node.json` 检查 Vite 配置，`tsconfig.test.json` 检查测试与初始化文件。`tsconfig.json` 统一引用三个配置，`pnpm typecheck` 通过 `tsc -b` 检查全部环境，缓存保存在前端 `node_modules/.cache` 中。

前端的 `@/` 指向 `apps/web/src/`，例如 `import { http } from '@/lib/http'`。TypeScript 配置与 Vite / Vitest 使用相同的映射，跨目录导入使用别名，同目录可保留相对路径。workspace 共享类型继续通过 `@nestjs-agent/shared` 导入。

TypeScript 7 使用官方 `typescript` 包和 `tsc` 做类型检查。前端使用 Vite 8 构建；NestJS 服务端直接使用 `tsc` 编译，采用 `NodeNext` 模块解析，输出 Node.js ESM。服务端相对导入使用 `.js` 扩展名，TypeScript 会解析到对应的 `.ts` 源文件。

服务端启用 `experimentalDecorators` 和 `emitDecoratorMetadata`，入口加载 `reflect-metadata`，NestJS 可根据构造函数参数类型自动注入依赖。接口、自定义 token 等依赖仍需使用 `@Inject(Token)` 显式声明。

服务端开发命令先完成一次编译，再并行运行 `tsc --watch` 和 `node --watch`，源码变更编译成功后自动重启服务。编译错误时不输出新的 JavaScript；生产构建会先清理 `dist`。

Oxlint 负责代码检查，Oxfmt 负责格式化，配置集中在根目录。

Cursor / VS Code 请安装项目推荐的官方 Oxc 扩展（`oxc.oxc-vscode`）。项目已配置保存时使用 Oxfmt，与 `pnpm format` 共用 `.oxfmtrc.json` 的单引号规则。

## Git 提交检查

安装依赖时，`prepare` 自动启用 Husky hooks。直接下载项目目录而非通过 Git 克隆时，先执行 `git init`，再执行 `pnpm prepare`。

- `pre-commit`：lint-staged 只处理暂存文件，使用 Oxfmt 自动格式化，使用 Oxlint 检查 JavaScript / TypeScript；格式化结果自动加入暂存区，检查失败则阻止提交。
- `commit-msg`：commitlint 按 Conventional Commits 校验提交信息。
- `pre-push`：运行 `pnpm typecheck`，使用 TypeScript 7 检查整个 workspace，失败则阻止推送。

提交信息格式为 `type(scope): 描述`，`scope` 可省略，描述可以使用中文。例如：

```text
feat(web): 添加登录页面
fix(server): 修复数据库连接
chore: 更新开发依赖
```

支持 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert` 等标准类型。`update code` 这样的消息会被拒绝。

在项目根目录运行 `pnpm lint:staged` 可以手动检查暂存文件。Git hooks 需要能找到 mise 管理的 Node.js 和 pnpm；终端需激活 mise，图形 Git 客户端也需能访问对应工具。CI 安装依赖时可设置 `HUSKY=0` 跳过 hooks 安装，并单独运行 `pnpm check` 和 `pnpm build`。
