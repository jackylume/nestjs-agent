# NestJS Agent

基于 pnpm workspace 的 TypeScript monorepo。React 负责前端，NestJS 提供 API，PostgreSQL 存储数据。

仓库地址：[jackylume/nestjs-agent](https://github.com/jackylume/nestjs-agent)。当前包含前端页面与请求基建、Token 状态管理、API 存活检查和数据库连通检查，尚未实现业务接口、登录鉴权或数据库迁移。

## 技术版本

版本以仓库中的 `mise.toml`、各包 `package.json`、`pnpm-workspace.yaml` 和 `compose.yaml` 为准，依赖使用精确版本并由 `pnpm-lock.yaml` 锁定。

前端基建使用 alova 3.5.5、React Router 8.4.0、Tailwind CSS 4.3.3、Ant Design 6.6.5、Zustand 5.0.15 和 Vitest 5.0.1。

| 工具           | 版本                     |
| -------------- | ------------------------ |
| Node.js        | 22.23.2                  |
| pnpm           | 10.34.5                  |
| TypeScript     | 7.0.2                    |
| Vite+          | 1.0.0                    |
| Vite           | 8.3.1（由 Vite+ 提供）   |
| React          | 19.3.0                   |
| NestJS         | 12.0.4                   |
| PostgreSQL     | 18.6（本地 Docker 镜像） |
| Oxlint / Oxfmt | 1.85.0 / 0.70.0          |

`mise.toml` 统一管理 Node.js、pnpm 的精确版本；`engines`、`.npmrc` 和安装前检查校验版本。今后更新补丁版本时须同步这些设置。

## 目录

```text
apps/
  web/          React 前端，Vite+ 开发服务器与生产构建
  server/       NestJS API，TypeScript 7 编译为 Node.js ESM
packages/
  shared/       前后端共享的 TypeScript 类型，只允许 import type
scripts/
  check-env.mjs Node.js / pnpm 版本检查
compose.yaml    本地 PostgreSQL
vite.config.ts  Vite+ 的检查、格式化和暂存文件配置
```

## 本地启动

需要安装 mise 并在当前 shell 中激活，以及已启动的 Docker（包含 Compose）。mise 会根据项目配置安装 Node.js 22.23.2 和 pnpm 10.34.5。也可以连接已有 PostgreSQL，此时跳过 `pnpm db:up` 并修改 `DATABASE_URL`。

```bash
git clone https://github.com/jackylume/nestjs-agent.git
cd nestjs-agent
mise trust
mise install
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm dev
```

已有本地仓库时跳过克隆步骤；已有 `.env` 时保留现有配置，按 `.env.example` 补齐缺少的变量。

如果尚未激活 mise，zsh 可先执行 `eval "$(mise activate zsh)"`；也可以通过 `mise exec -- pnpm <命令>` 使用项目指定的工具版本。

- 前端：<http://localhost:5173>
- 前端服务状态页：<http://localhost:5173/health>
- API 存活检查：<http://127.0.0.1:3000/api/health>
- 数据库连通检查：<http://127.0.0.1:3000/api/health/db>

前端通过 Vite 将 `/api` 代理到 NestJS。根目录 `.env` 中的 `PORT` 同时供前端代理和服务端读取，修改后重启开发命令。只有 `VITE_` 前缀变量会公开给浏览器，不要给数据库凭据添加此前缀。

数据库检查会执行 `SELECT 1`：成功返回 HTTP 200，数据库不可达时返回 HTTP 503。服务启动不要求数据库立即可达，但必须配置 `DATABASE_URL`。`pg` 连接池在服务关闭时释放；目前没有业务表或 ORM。

Compose 的默认账号和密码仅用于本地开发，端口仅绑定本机。修改账号、密码或数据库名时，也需同步 `DATABASE_URL`；已有数据卷不会因环境变量变化而重新初始化。`pnpm db:down` 停止数据库但保留数据卷。

### 环境变量

在项目根目录配置 `.env`，该文件已被 Git 忽略；提交配置示例时修改 `.env.example`。

| 变量                | 示例值                                                | 用途                                    |
| ------------------- | ----------------------------------------------------- | --------------------------------------- |
| `PORT`              | `3000`                                                | NestJS 监听端口和 Vite 开发代理目标端口 |
| `POSTGRES_USER`     | `agent`                                               | Compose 初始化数据库用户名              |
| `POSTGRES_PASSWORD` | `agent_local`                                         | Compose 初始化数据库密码                |
| `POSTGRES_DB`       | `agent`                                               | Compose 初始化数据库名                  |
| `DATABASE_URL`      | `postgresql://agent:agent_local@127.0.0.1:5432/agent` | NestJS 连接数据库的必填地址             |

服务端仅通过 `DATABASE_URL` 建立连接，不会根据 `POSTGRES_*` 自动拼接地址。使用外部 PostgreSQL 时，将其改为对应连接地址即可。

### 验证启动结果

保持 `pnpm dev` 运行，在另一个终端执行以下命令（修改 `PORT` 后替换示例端口）：

```bash
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/health/db
```

| 接口                 | 成功响应（HTTP 200）                     | 检查范围                     |
| -------------------- | ---------------------------------------- | ---------------------------- |
| `GET /api/health`    | `{"status":"ok"}`                        | API 可响应请求，不检查数据库 |
| `GET /api/health/db` | `{"status":"ok","database":"connected"}` | PostgreSQL 能执行 `SELECT 1` |

数据库检查失败时返回 HTTP 503，响应中的 `message` 为 `数据库暂不可用`。打开前端 `/health` 页面也可以分别检查这两个接口。

## 常用命令

```bash
pnpm dev                         # 并行启动前后端，服务端修改后重新构建并重启
pnpm check                       # Vite+ 静态检查、tsc 类型检查及 Vitest 测试
pnpm test                        # 运行 workspace 中的测试
pnpm test:watch                  # 前端 Vitest 监听模式
pnpm format                      # Oxfmt 格式化
pnpm lint:fix                    # Oxlint 自动修复
pnpm build                       # 类型检查，前端使用 vp build，服务端使用 tsc 构建
pnpm --filter @nestjs-agent/server start
pnpm --filter @nestjs-agent/web preview
```

前端产物位于 `apps/web/dist`，服务端产物位于 `apps/server/dist`。服务端构建保留 npm 依赖为外部依赖，运行时仍需要安装 workspace 的依赖。生产环境需由 Web 服务器托管前端静态文件并将 `/api` 转发到 NestJS；非 API 的前端路由（如 `/health`）需回退到 `index.html`，保证直接访问和刷新可用。`vp preview` 仅用于静态产物预览，不提供这里的开发 API 代理。

## Vite+ 任务编排

pnpm 继续负责依赖和 workspace 链接；项目本地的 Vite+ 提供 `vp` 命令，根目录 pnpm 脚本使用 `vp run` 编排各包任务。直接调用内置命令时可使用 `pnpm exec vp check`；只运行前端测试时使用 `pnpm exec vp -C apps/web test`。

- `pnpm check` 依次运行 `vp check`、各包 `tsc` 类型检查和现有测试；`pnpm build` 先检查类型，再运行前端 Vite 构建与服务端 `tsc` 构建。
- `vp run` 按 workspace 依赖顺序执行包脚本。类型检查、测试和构建开启本地任务缓存；开发与测试监听并行运行，不缓存。Vite+ 自动追踪任务读取的文件、环境变量及生成的文件。
- 根目录 `vite.config.ts` 管理静态检查、格式化和暂存文件规则；`apps/web/vite.config.ts` 管理前端开发服务器、构建和测试。NestJS 仍由 `tsc` 编译为 Node.js ESM。

可用 `pnpm exec vp run --filter '@nestjs-agent/*' --cache build -v` 查看任务执行与缓存详情。

## React 前端基建

```text
apps/web/src/
  app/             Ant Design 全局配置、路由定义和路由测试
  layouts/         公共布局与导航
  pages/           首页、服务状态、404、路由错误兜底
  features/health/  健康检查接口
  lib/http.ts      alova 请求实例与统一 HTTP 错误处理
  stores/auth.ts   Zustand Token 状态与本地持久化
  test/setup.ts    Vitest DOM 环境初始化
```

- 请求统一使用 `lib/http.ts` 导出的 alova 实例，API 前缀为 `/api`，超时 10 秒。非成功 HTTP 响应抛出带有 `status` 的 `ApiError`，兼容 NestJS 字符串 / 数组错误信息和非 JSON 错误页；204 响应返回 `undefined`。
- 业务接口按功能放在 `features` 中，组件使用 `alova/client` 的 `useRequest` 管理加载、数据和错误状态。健康检查配置 `cacheFor: 0`，每次重新检查都会访问服务端。共享类型提供编译期约束，不替代运行时数据校验。
- React Router 使用浏览器历史路由，首页和服务状态页按路由懒加载；路由统一定义在 `app/routes.tsx`，公共布局包含导航和加载状态。
- Tailwind CSS 通过 Vite 插件接入，负责布局、间距和自定义样式；Ant Design 负责交互组件，通过 `ConfigProvider` 设置中文和主题，通过 `App.useApp()` 获取后续业务需要的 message / notification / modal 实例。
- 全局 CSS 声明 `theme, base, antd, components, utilities` 的层级顺序，配合 `StyleProvider layer`，让 Tailwind 的重置样式与 Ant Design 组件样式正常共存。Ant Design 主题优先通过 token 调整。
- Vitest 使用 jsdom、React Testing Library 和 jest-dom。测试替换网络边界的 `fetch`，保留真实 alova 请求处理和页面逻辑；测试文件与对应代码相邻。`pnpm check` 包含测试，Git 推送前仍运行全项目类型检查。

## NestJS 服务端结构

```text
apps/server/src/
  main.ts                       创建应用、设置 /api 前缀、启用关闭钩子
  app.module.ts                 根模块，导入 HealthModule
  health/
    health.module.ts            注册 HealthController，导入 DatabaseModule
    health.controller.ts        提供 API 与数据库健康检查接口
  database/
    database.module.ts          注册并导出 DatabaseService
    database.service.ts         管理 pg 连接池、执行连通检查、关闭时释放连接
```

模块依赖为 `AppModule → HealthModule → DatabaseModule`。`HealthController` 通过构造函数注入 `DatabaseService`；`DatabaseModule` 使用 `exports` 暴露服务，`HealthModule` 使用 `imports` 获得该依赖。其他业务模块需要数据库时，同样导入 `DatabaseModule`，无需重复注册 `DatabaseService`。

连接池最多使用 10 个连接，连接超时和查询超时均设为 3 秒。前后端健康检查的响应类型统一定义在 `packages/shared/src/index.ts`。

服务端当前监听 `127.0.0.1`，适用于本机访问或同机反向代理；部署到容器或需要外部直连时，需要根据部署方式调整 `main.ts` 中的监听地址。

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

Vite+ 的 `vp check` 集成 Oxlint、Oxfmt 和类型感知检查；完整类型检查继续使用各包的 `tsc` 脚本。相关规则集中在根目录 `vite.config.ts`。

Cursor / VS Code 请安装项目推荐的官方 Oxc 扩展（`oxc.oxc-vscode`）。项目已配置保存时使用 Oxfmt，与 `pnpm format` 共用根目录 `vite.config.ts` 的单引号规则。

## Git 提交检查

安装依赖时，`prepare` 通过 `vp config` 启用 Vite+ hooks。直接下载项目目录而非通过 Git 克隆时，先执行 `git init`，再执行 `pnpm prepare`。

- `pre-commit`：`vp staged` 只处理暂存文件，使用 Oxfmt 自动格式化，使用 Oxlint 检查 JavaScript / TypeScript；格式化结果自动加入暂存区，检查失败则阻止提交。
- `commit-msg`：commitlint 按 Conventional Commits 校验提交信息。
- `pre-push`：运行 `pnpm typecheck`，使用 TypeScript 7 检查整个 workspace，失败则阻止推送。

提交信息格式为 `type(scope): 描述`，`scope` 可省略，描述可以使用中文。例如：

```text
feat(web): 添加登录页面
fix(server): 修复数据库连接
chore: 更新开发依赖
```

支持 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert` 等标准类型。`update code` 这样的消息会被拒绝。

在项目根目录运行 `pnpm lint:staged` 可以手动检查暂存文件。Git hooks 需要能找到 mise 管理的 Node.js 和 pnpm；终端需激活 mise，图形 Git 客户端也需能访问对应工具。CI 安装依赖时可设置 `VP_GIT_HOOKS=0` 跳过 hooks 安装，并单独运行 `pnpm check` 和 `pnpm build`。

## 常见问题

| 现象                                           | 排查方法                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 安装依赖提示 Node.js 或 pnpm 版本不匹配        | 在项目根目录执行 `mise install`，确认 shell 已激活 mise，再运行 `node --version` 和 `pnpm --version` 核对版本         |
| 服务端提示缺少 `DATABASE_URL`                  | 检查根目录 `.env` 是否存在、连接地址是否为空，然后重启服务                                                            |
| `/api/health` 正常但 `/api/health/db` 返回 503 | 执行 `docker compose ps` 和 `docker compose logs postgres` 检查数据库，再核对 `DATABASE_URL` 中的端口、账号和数据库名 |
| 前端提示 5173 端口被占用                       | Vite 配置了 `strictPort`，不会自动换端口；停止占用该端口的进程后重试                                                  |
| API 无法启动或前端代理连接失败                 | 检查服务端终端输出和 3000 端口占用情况；如需修改端口，更新根目录 `.env` 的 `PORT` 后重启 `pnpm dev`                   |
| 修改 Compose 账号或密码后连接失败              | 已有数据卷保留原有数据库配置；使用原有凭据连接并修改数据库账号，同时同步 `.env`                                       |
| 生产环境刷新 `/health` 返回 404                | 检查静态服务器是否将前端路由回退到 `index.html`，并为 `/api` 单独配置反向代理                                         |
