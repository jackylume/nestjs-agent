# NestJS Agent

基于 pnpm workspace 的 TypeScript monorepo。React 负责前端，NestJS 提供 API，PostgreSQL 保存用户数据，Redis 保存登录会话。

仓库地址：[jackylume/nestjs-agent](https://github.com/jackylume/nestjs-agent)。当前包含前端页面与请求基建、用户注册、双 Token 登录与退出、JWT 与 Redis 会话鉴权、API 存活检查、PostgreSQL / Redis 连通检查和 Prisma 数据访问与迁移基建。

## 技术版本

版本以仓库中的 `.mise.toml`、各包 `package.json`、`pnpm-workspace.yaml` 和 `compose.yaml` 为准，依赖使用精确版本并由 `pnpm-lock.yaml` 锁定。

前端基建使用 alova 3.5.5、React Router 8.4.0、Tailwind CSS 4.3.3、Ant Design 6.6.5、Zustand 5.0.15 和 Vitest 5.0.1。

| 工具                 | 版本                       |
| -------------------- | -------------------------- |
| Node.js              | 22.23.4                    |
| pnpm                 | 10.34.9                    |
| TypeScript           | 7.0.2                      |
| Vite+                | 1.0.0                      |
| Vite                 | 8.3.1（由 Vite+ 提供）     |
| React                | 19.3.0                     |
| NestJS               | 12.3.2                     |
| Prisma               | 7.10.1                     |
| PostgreSQL           | 18.6（本地 Docker 镜像）   |
| Redis                | 8.10.3（本地 Docker 镜像） |
| Nginx                | 1.30.6（本地 Docker 镜像） |
| Redis Node.js 客户端 | 6.3.1                      |
| Oxlint / Oxfmt       | 1.85.0 / 0.70.0            |

`.mise.toml` 统一管理 Node.js、pnpm 的精确版本；`engines`、`.npmrc` 和安装前检查校验版本。今后更新补丁版本时须同步这些设置。

## 目录

```text
apps/
  web/          React 前端，Vite+ 开发服务器与生产构建
  server/       NestJS API，VP 构建为 Node.js ESM
packages/
  shared/       前后端共享的 TypeScript 类型，只允许 import type
scripts/
  check-env.mjs Node.js / pnpm 版本检查
nginx.conf      Nginx 开发入口，代理 Vite 页面、热更新与 NestJS API
compose.yaml    本地 PostgreSQL、Redis 与 Nginx
vite.config.ts  Vite+ 的检查、格式化和暂存文件配置
```

## 本地启动

需要安装 mise 并在当前 shell 中激活，以及已启动的 Docker（包含 Compose）。mise 会根据项目配置安装 Node.js 22.23.4 和 pnpm 10.34.9。也可以连接已有 PostgreSQL，此时跳过 `pnpm db:up` 并修改 `DATABASE_URL`。

```bash
git clone https://github.com/jackylume/nestjs-agent.git
cd nestjs-agent
mise trust
mise install
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm redis:up
pnpm db:deploy
pnpm nginx:up
pnpm dev
```

已有本地仓库时跳过克隆步骤；已有 `.env` 时保留现有配置，按 `.env.example` 补齐缺少的变量。

Nginx 直接代理 Vite 开发服务器，无需先构建前端；修改 React 代码后，热更新也通过 Nginx 连接。

如果尚未激活 mise，zsh 可先执行 `eval "$(mise activate zsh)"`；也可以通过 `mise exec -- pnpm <命令>` 使用项目指定的工具版本。

- 前端：<http://localhost:8080>
- 注册页面：<http://localhost:8080/register>
- 前端服务状态页：<http://localhost:8080/health>
- API 存活检查：<http://127.0.0.1:3000/health>
- 数据库连通检查：<http://127.0.0.1:3000/health/db>
- Redis 连通检查：<http://127.0.0.1:3000/health/redis>

浏览器统一访问 `http://localhost:8080`。Nginx 将页面、资源和热更新 WebSocket 转发到 Vite 的 `127.0.0.1:5173`，将 `/api/` 请求移除前缀后转发到 NestJS 的 `127.0.0.1:3000`。例如浏览器请求 `/api/health`，最终访问后端 `/health`。前端统一使用 `baseURL: '/api'`，页面和 API 同源，无需 CORS 配置；Vite 不再代理 API。

根目录 `.env` 中的 `PORT` 仅设置 NestJS 监听端口；修改时需同步 `nginx.conf` 中的 `proxy_pass` 端口，重启后端并检查、重新加载 Nginx 配置。只有 `VITE_` 前缀变量会公开给浏览器，不要给数据库凭据添加此前缀。

数据库检查通过 Prisma 执行 `SELECT 1`：成功返回 HTTP 200，数据库不可达时返回 HTTP 503。服务启动不要求数据库立即可达，但必须配置 `DATABASE_URL`。服务关闭时调用 Prisma 的 `$disconnect()` 释放连接。注册使用迁移创建的 `User` 表，首次使用前执行 `pnpm db:deploy`。

Prisma 负责类型安全的业务查询和数据库迁移，PostgreSQL 连接通过 `@prisma/adapter-pg` 适配器建立。`pg` 由 `@prisma/adapter-pg` 作为间接依赖安装，项目无需直接声明，调用关系为 `NestJS → Prisma Client → @prisma/adapter-pg → pg → PostgreSQL`。

Compose 的默认账号和密码仅用于本地开发，端口仅绑定本机。修改账号、密码或数据库名时，也需同步 `DATABASE_URL`；已有数据卷不会因环境变量变化而重新初始化。Redis 绑定 `127.0.0.1:6379`，使用独立数据卷和 AOF 持久化，采用 `noeviction` 策略避免内存压力下自动淘汰登录会话。`pnpm redis:down` 仅停止 Redis；`pnpm db:down` 会停止整个 Compose 项目（包括 PostgreSQL、Redis 和 Nginx），保留两个数据卷。

使用 Navicat 时，新建 PostgreSQL 连接，主机填写 `127.0.0.1`，端口填写 `5433`；用户名、密码和数据库名使用根目录 `.env` 中的 `POSTGRES_USER`、`POSTGRES_PASSWORD` 和 `POSTGRES_DB`。无需开启 SSH 隧道。

### 环境变量

在项目根目录配置 `.env`，该文件已被 Git 忽略；提交配置示例时修改 `.env.example`。

| 变量                | 示例值                                          | 用途                                         |
| ------------------- | ----------------------------------------------- | -------------------------------------------- |
| `PORT`              | `3000`                                          | NestJS 监听端口，需与 Nginx 后端代理端口一致 |
| `POSTGRES_USER`     | `admin`                                         | Compose 初始化数据库用户名                   |
| `POSTGRES_PASSWORD` | `admin`                                         | Compose 初始化数据库密码                     |
| `POSTGRES_DB`       | `agent`                                         | Compose 初始化数据库名                       |
| `DATABASE_URL`      | `postgresql://admin:admin@127.0.0.1:5433/agent` | NestJS 连接数据库的必填地址                  |
| `REDIS_URL`         | `redis://127.0.0.1:6379`                        | NestJS 连接 Redis 的必填地址                 |

服务端仅通过 `DATABASE_URL` 建立连接，不会根据 `POSTGRES_*` 自动拼接地址。使用外部 PostgreSQL 时，将其改为对应连接地址即可。

### 验证启动结果

保持 Nginx 和 `pnpm dev` 运行，在另一个终端执行以下命令（修改 `PORT` 后替换后端示例端口）：

```bash
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/health/db
curl -i http://127.0.0.1:3000/health/redis
curl -i http://localhost:8080/api/health
```

| 接口                | 成功响应中的 `data`（HTTP 200）          | 检查范围                     |
| ------------------- | ---------------------------------------- | ---------------------------- |
| `GET /health`       | `{"status":"ok"}`                        | API 可响应请求，不检查数据库 |
| `GET /health/db`    | `{"status":"ok","database":"connected"}` | PostgreSQL 能执行 `SELECT 1` |
| `GET /health/redis` | `{"status":"ok","redis":"connected"}`    | Redis 能执行 `PING`          |

所有接口统一返回 `{ code, success, data, msg }`。成功响应的 HTTP 状态码和 `code` 均为 200，`success` 为 `true`，`msg` 为 `请求成功`；没有业务数据时 `data` 为 `null`。失败时保留实际 HTTP 错误状态码，`code` 与其一致，`success` 为 `false`，`data` 为 `null`，`msg` 为错误说明。错误消息为数组时只返回第一条；DTO 校验开启 `stopAtFirstError`，每个字段遇错后停止该字段的后续校验，其他字段仍会校验。未知服务端异常统一返回 `服务器内部错误`。

数据库检查失败时返回 HTTP 503，响应为 `{ "code": 503, "success": false, "data": null, "msg": "数据库暂不可用" }`。打开前端 `/health` 页面也可以分别检查这两个接口。

### 用户注册

`POST /auth/register` 接收 `{ "username": "jacky", "password": "your-password" }`，前端通过 `/api/auth/register` 调用。用户名去除首尾空白后为 3–32 个字符，仅允许不含空格的可打印 ASCII（`0x21–0x7E`）。密码为 6–16 个字符，仅允许可打印 ASCII（`0x20–0x7E`），可包含空格但不能全为空格，按原样进行带随机盐的 Argon2id 哈希，不去除空格或截断。两者均不允许中文和 emoji，也不要求混合多种字符类别。

注册成功返回 HTTP 200，响应体为 `{ "code": 200, "success": true, "data": { "id": 1, "username": "jacky" }, "msg": "请求成功" }`；无效输入返回 HTTP 400，用户名重复返回 HTTP 409。响应不包含密码哈希，也不会自动登录；注册成功后可前往登录页。

注册参数规则定义在 `apps/server/src/auth/dto/register.dto.ts`，由全局 `ValidationPipe` 校验并转换为 DTO，额外字段会被过滤。`AuthController` 接收校验后的 `RegisterDto`，`AuthService` 负责密码哈希、创建用户和处理用户名冲突；DTO 与前端共用 `packages/shared` 的请求类型约定。

### 登录与退出

`POST /auth/login` 接收 `{ "username": "jacky", "password": "your-password" }`，校验规则与注册相同。使用 Argon2id 密码哈希验证身份，账号不存在与密码错误统一返回 HTTP 401。成功返回 HTTP 200，`data` 仅包含 `accessToken`、`accessTokenExpiresAt`、`refreshToken`、`refreshTokenExpiresAt`，不包含用户信息；两个到期时间均为 ISO 字符串。前端将两个 Token 一起保存到 `localStorage` 后进入 `/home`。

当前不兼容旧的 scrypt 密码哈希，旧账号需重置密码或重新注册后才能登录。

Access Token 是带签名的 JWT，默认有效 **2 小时**；Refresh Token 是会话 ID 与 32 字节随机值组成的凭证，有效 **7 天**。有效期在 `apps/server/src/config/auth.ts` 中定义。JWT 包含用户 ID、会话 ID、凭证类型和到期时间，并验证签名算法、issuer 与 audience。Redis 的 `nestjs-agent:session:<会话ID>` 保存 Refresh Token 的 SHA-256 哈希、用户 ID、登录时的认证版本和固定到期时间；创建时原子设置 TTL，到期自动失效，不保存密码或原始 Token。

普通接口通过 `Authorization: Bearer <accessToken>` 认证，同时检查 Redis 会话仍有效，并从 PostgreSQL 读取用户及认证版本。User 模块的 `GET /user/info` 单独返回当前用户，成功响应的 `data` 为 `{ "id": 1, "username": "jacky" }`，不包含密码哈希；前端通过 `/api/user/info` 调用，也用于恢复登录状态。Access Token 过期后，前端调用 `POST /auth/refresh`，请求体为 `{ "refreshToken": "..." }`，成功仅返回与登录相同的 Token 及过期时间。刷新通过 Redis Lua 脚本原子比较并替换 Refresh Token 哈希，保留原 TTL，使旧 Refresh Token 立即失效；同一凭证并发刷新只有一次成功。7 天从登录时起算，刷新不会延长会话，新 Access Token 的到期时间也不会超过会话到期时间。

`POST /auth/logout` 从 `Authorization: Bearer <accessToken>` 读取当前会话，不接收请求体。JWT Guard 验证通过后，服务端使用 Token 中的会话 ID 撤销当前会话并返回 HTTP 200、`data: null`；该会话的 Access Token 与 Refresh Token 均无法继续使用，其他会话保持有效。缺少、过期或已撤销的 Access Token 返回 HTTP 401。前端收到退出接口的 401 后，使用 Refresh Token 刷新并重试退出一次；成功后清除两个 Token，网络失败可重试。

`POST /auth/change-password` 通过 `Authorization: Bearer <accessToken>` 认证，接收 `{ "oldPassword": "old-password", "newPassword": "new-password" }`。两个密码均沿用注册密码规则，保留首尾空格。用户 ID 来自鉴权结果，不能通过请求体指定。旧密码错误返回 HTTP 400；并发修改造成密码已变更时返回 HTTP 409。成功时使用同一条 PostgreSQL 条件更新写入密码哈希并递增 `User.authVersion`，使该用户的所有旧版本会话立即失效，返回 HTTP 200、`data: null`；所有设备（包括当前设备）需重新登录，旧 Access Token 和 Refresh Token 均失效。登录会话绑定首次读取并验证的密码对应版本，防止旧密码登录与改密并发时留下有效会话。旧版本 Redis key 由原 TTL 自动清理，无需跨 PostgreSQL 与 Redis 执行事务。删除用户后，Redis 中遗留的会话也无法通过用户存在性检查。

根目录 `.env` 必须设置至少 32 字节的随机 `JWT_SECRET`；服务启动时会检查，不能使用公开的示例密钥。可使用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成后填入本地配置，不提交实际密钥。旧版单 Token 登录状态在升级后需要重新登录。

迁移 `20261029000000_redis_sessions` 增加用户认证版本并删除旧 PostgreSQL `Session` 表；已有登录会话不迁移，需要重新登录，用户及密码数据保留。Redis 不可用或操作等待超过 3 秒时返回 HTTP 503，不按凭据失效处理；超时不能撤回 Redis 已收到的写入。

历史迁移 `20261026220000_restore_session_table` 仅在 `Session` 表缺失时恢复表、索引和外键，空库顺序执行时会跳过已有表，最终由 Redis 迁移删除该表。已应用旧版恢复迁移的数据库，需要核对数据库结构与原文件校验值后，同步 `_prisma_migrations` 中该条成功记录的 `checksum`；无需重置数据库或重新执行恢复 SQL。

迁移回归测试会在本机 PostgreSQL 中创建独立临时数据库，验证完整部署、重复部署、最终结构及恢复迁移的两条分支，结束后删除临时库；连接账号需有创建数据库权限：

```bash
MIGRATION_DB_INTEGRATION=1 pnpm --filter @nestjs-agent/server exec vp test run tests/database/migrations.integration.test.ts
```

启动 PostgreSQL、Redis 并应用迁移后，可运行真实链路集成测试；测试使用临时端口，创建独立测试用户及 Redis key 并在结束后清理：

```bash
AUTH_DB_INTEGRATION=1 pnpm --filter @nestjs-agent/server exec vp test run tests/auth/auth.integration.test.ts tests/auth/change-password.integration.test.ts tests/auth/session.service.integration.test.ts
```

## 常用命令

```bash
pnpm dev                         # 并行启动前后端，服务端由 vpx 运行并监听重启
pnpm check                       # Vite+ 格式、lint、类型检查及 Vitest 测试
pnpm typecheck                   # 仅使用 vp check 检查各包类型
pnpm test                        # 运行 workspace 中的测试
pnpm test:watch                  # 前端 Vitest 监听模式
pnpm format                      # Oxfmt 格式化
pnpm lint:fix                    # Oxlint 自动修复
pnpm build                       # 类型检查，前端使用 vp build，服务端使用 vp pack
pnpm redis:up                    # 启动并等待本地 Redis 健康
pnpm redis:down                  # 仅停止 Redis，保留数据卷
pnpm nginx:up                    # 启动 Nginx 开发入口，无需先构建前端
pnpm nginx:down                  # 仅停止 Nginx
pnpm db:generate                 # 根据 Prisma schema 生成 Client
pnpm db:migrate --name <name>    # 根据 schema 创建并应用本地开发迁移
pnpm db:deploy                   # 部署已提交的迁移
pnpm --filter @nestjs-agent/server start
pnpm --filter @nestjs-agent/web preview
```

前端产物位于 `apps/web/dist`，服务端产物位于 `apps/server/dist`。服务端构建保留 npm 依赖为外部依赖，运行时仍需要安装 workspace 的依赖；`pnpm start` 使用 `vpx`，也需要提供 `vite-plus`。`vp preview` 仅用于静态产物预览，不提供 API 代理。

### Nginx 统一开发入口

本地 Docker Desktop 使用 Nginx 统一接收浏览器请求，通过 `host.docker.internal` 访问宿主机上的 Vite 和 NestJS。完成上面的依赖安装、环境配置和数据库迁移后，保持 PostgreSQL、Redis 运行，再执行：

```bash
pnpm nginx:up
pnpm dev
```

打开 <http://localhost:8080>，在另一个终端检查接口：

```bash
curl -i http://localhost:8080/api/health
curl -i http://localhost:8080/api/health/db
curl -i http://localhost:8080/api/health/redis
```

Nginx 只绑定本机 `8080` 端口，页面和 API 使用同一来源：

- 页面和资源请求转发到 Vite 的 `5173` 端口，由 Vite 处理前端路由刷新。
- 热更新 WebSocket 也通过 `8080` 转发到 Vite，浏览器无需直接连接 `5173`。
- `/api/health` 转发到 NestJS 的 `/health`，其他 `/api/` 请求按相同规则移除前缀。

Nginx 不会启动 Vite 或 NestJS；Vite 未运行时页面请求返回 502，NestJS 未运行时 API 请求返回 502。容器健康检查使用 `nginx -t`，只检查 Nginx 配置，不验证 HTTP 服务或上游可用性；页面和接口需单独检查。Compose 不挂载 `apps/web/dist`，启动 Nginx 无需构建前端。

根目录 `nginx.conf` 直接只读挂载为容器的 `/etc/nginx/nginx.conf`，前端和后端代理端口分别为 `5173`、`3000`。修改 Vite 端口或根目录 `.env` 的 `PORT` 时，需同步修改对应的 `proxy_pass` 端口并重启服务。修改 Nginx 配置后，先运行 `docker compose exec nginx nginx -t` 检查，再运行 `docker compose exec nginx nginx -s reload` 加载配置；修改 Compose 挂载或健康检查后运行 `pnpm nginx:up` 重建容器。`pnpm nginx:down` 仅停止 Nginx。

这套配置面向本机 Docker Desktop。配置文件挂载参考 [Nginx 官方镜像文档](https://hub.docker.com/_/nginx)，代理路径规则参考 [proxy_pass 官方文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)，热更新连接参考 [WebSocket 代理文档](https://nginx.org/en/docs/http/websocket.html)。

### 生产部署说明

当前 `nginx.conf` 用于开发，运行 `pnpm build` 不会让它自动切换到构建产物。生产部署时，应将页面代理改为静态文件托管，挂载 `apps/web/dist` 并配置 `root`、`index` 和 `try_files $uri $uri/ /index.html`；移除开发用的 WebSocket 代理，保留 `/api/` 的前缀移除与后端转发。后端使用构建后的 NestJS，代理地址、域名和 HTTPS 按实际部署环境配置，生产环境无需运行 Vite 开发服务器。

## Vite+ 任务编排

pnpm 继续负责依赖和 workspace 链接；项目本地的 Vite+ 提供 `vp` 和 `vpx` 命令，根目录 pnpm 脚本使用 `vp run` 编排各包任务。直接调用内置命令时可使用 `pnpm exec vp check`；只运行前端测试时使用 `pnpm exec vp -C apps/web test`。安装前的环境校验使用 `node scripts/check-env.mjs`，因为首次安装时 `vpx` 尚不可用。

- `pnpm check` 先生成 Prisma Client，再运行 `vp check` 和现有测试；`pnpm typecheck` 通过各包的 `vp check --no-fmt --no-lint` 只检查类型；`pnpm build` 先检查类型，再运行前端 `vp build` 与服务端 `vp pack`。
- `vp run` 按 workspace 依赖顺序执行包脚本。类型检查、测试和构建开启本地任务缓存；开发与测试监听并行运行，不缓存。Vite+ 自动追踪任务读取的文件、环境变量及生成的文件。
- 根目录 `vite.config.ts` 管理静态检查、格式化和暂存文件规则；`apps/web/vite.config.ts` 管理前端开发服务器、构建和测试；`apps/server/vite.config.ts` 管理 NestJS 的 Node.js ESM 构建。

可用 `pnpm exec vp run --filter '@nestjs-agent/*' --cache build -v` 查看任务执行与缓存详情。

## React 前端基建

```text
apps/web/src/
  config/providers.tsx Ant Design 全局配置与 Provider 组合
  router/index.tsx 路由定义
  layouts/         公共布局与导航
  pages/           每个页面独立目录，入口为 index.tsx
    home/index.tsx 首页
    health/index.tsx 服务状态
    login/index.tsx 登录页面
    register/index.tsx 注册页面
    not-found/index.tsx 404 页面
    route-error/index.tsx 路由错误兜底
  api/             HTTP 请求封装与按模块划分的业务接口
    http.ts        alova 请求实例、Token 认证拦截器、响应解包与错误处理
    auth/index.ts  登录、注册、刷新与退出接口
    auth/session.ts Token 轮换、跨标签页协调及登录会话管理
    health/index.ts 健康检查接口
  validators/auth/index.ts 登录与注册表单校验规则
  stores/auth.ts   Zustand Token 状态与本地持久化

apps/web/tests/     集中存放前端测试，与 src 同级，目录映射 src 下对应源码
  setup.ts         Vitest DOM 环境初始化
  api/http.test.ts HTTP 请求测试
  router/index.test.tsx 路由测试
  stores/auth.test.ts Token 状态测试
  pages/login/index.test.tsx 登录页面测试
  pages/register/index.test.tsx 注册页面测试
```

- 请求统一使用 `api/http.ts` 导出的 alova 实例，开发与生产均使用同源 `/api`，超时 10 秒。成功响应解包 `data`，页面直接使用业务数据；HTTP 失败或 `success: false` 时，从 `msg` 读取错误信息并抛出附带 HTTP `status` 和响应 `code` 的原生 `Error`。兼容旧 NestJS 字符串 / 数组错误信息和非 JSON 错误页；204 响应返回 `undefined`。
- 业务接口按模块目录放在 `api` 中，例如 `api/auth/index.ts` 和 `api/health/index.ts`，表单校验统一放在 `validators` 中，例如 `validators/auth/index.ts`；组件使用 `alova/client` 的 `useRequest` 管理加载、数据和错误状态。健康检查配置 `cacheFor: 0`，每次重新检查都会访问服务端。共享类型提供编译期约束，不替代运行时数据校验。
- React Router 使用浏览器历史路由，首页和服务状态页按路由懒加载；路由统一定义在 `router/index.tsx`，公共布局包含导航和加载状态。
- Tailwind CSS 通过 Vite 插件接入，负责布局、间距和自定义样式；Ant Design 负责交互组件，通过 `ConfigProvider` 设置中文和主题，通过 `App.useApp()` 获取后续业务需要的 message / notification / modal 实例。
- 全局 CSS 声明 `theme, base, antd, components, utilities` 的层级顺序，配合 `StyleProvider layer`，让 Tailwind 的重置样式与 Ant Design 组件样式正常共存。Ant Design 主题优先通过 token 调整。
- Vitest 使用 jsdom、React Testing Library 和 jest-dom。测试替换网络边界的 `fetch`，保留真实 alova 请求处理和页面逻辑；前端测试集中在与 `src` 同级的 `tests`，按对应源码目录组织，例如 `src/pages/login/index.tsx` 对应 `tests/pages/login/index.test.tsx`，环境初始化保留在 `tests/setup.ts`。`pnpm check` 包含测试，Git 推送前仍运行全项目类型检查。

## NestJS 服务端结构

服务端使用 `@nestjs/platform-node` 的 `NodeAdapter`，基于 Node.js 原生 HTTP 服务；`main.ts` 与 HTTP 测试均显式指定此适配器。路由区分大小写，按路径具体程度匹配；路由参数默认最长 100 个字符。

服务端测试统一放在与 `src` 同级的 `apps/server/tests/`，按 `auth`、`common`、`config` 等源码模块组织。运行 `pnpm --filter @nestjs-agent/server test --run` 执行后端测试；真实数据库集成测试仍需显式设置 `AUTH_DB_INTEGRATION=1`。

```text
apps/server/src/
  main.ts                       创建应用、接入 Pino、启用全局参数校验与关闭钩子
  app.module.ts                 根模块，导入业务模块与 LoggerModule，注册全局守卫、拦截器与过滤器
  config/logger.ts              Pino 日志级别与请求、响应字段配置
  common/
    guards/global.guard.ts      全局守卫骨架，当前放行请求
    interceptors/success.interceptor.ts 成功结果包装与 HTTP 200
    filters/error.filter.ts 统一错误响应与未知异常日志
  health/
    health.module.ts            注册 HealthController，导入 DatabaseModule 和 RedisModule
    health.controller.ts        提供 API、PostgreSQL 和 Redis 健康检查接口
  database/
    database.module.ts          注册并导出 DatabaseService
    database.service.ts         继承 PrismaClient、执行连通检查、关闭时释放连接
  redis/
    redis.module.ts             注册并导出 RedisService
    redis.service.ts            连接、限时执行、健康检查与关闭释放
  auth/session.service.ts       Redis 会话存取、固定 TTL 和原子令牌轮换
  generated/prisma/             Prisma 生成的 Client，不提交到 Git
```

模块依赖为 `AppModule → HealthModule → DatabaseModule`。`HealthController` 通过构造函数注入 `DatabaseService`；`DatabaseModule` 使用 `exports` 暴露服务，`HealthModule` 使用 `imports` 获得该依赖。其他业务模块需要数据库时，同样导入 `DatabaseModule`，无需重复注册 `DatabaseService`。

连接池最多使用 10 个连接，连接超时和查询超时均设为 3 秒。前后端的 `ApiResponse<T>` 及业务数据类型统一定义在 `packages/shared/src/index.ts`。

`AppModule.providers` 通过 `APP_GUARD`、`APP_INTERCEPTOR` 和 `APP_FILTER` 集中注册全局守卫、响应拦截器与异常过滤器。`SuccessInterceptor` 在 Controller、Service 返回后包装成功结果并设置 HTTP 200；`ErrorFilter` 处理未捕获异常。Controller 和 Service 直接返回业务数据，无需逐个包装响应或指定成功状态码。

`GlobalGuard` 继承 `@nestjs/passport` 的 `AuthGuard('jwt')`，默认检查 Bearer 请求头格式并触发 `JwtStrategy`。`passport-jwt` 提取 Access Token，校验签名、有效期、issuer 与 audience；策略随后调用 `AuthService.validateAccessToken()` 检查业务 claims、Redis 会话及 PostgreSQL 用户认证版本，并将当前用户及会话 ID 放入 `request.user`。`@nestjs/jwt` 负责签发 Access Token，两处共用 `config/auth.ts` 的密钥及验证配置。注册、登录、刷新和健康检查通过 `@Public()` 跳过 Access Token 检查；退出从已验证的 Access Token 读取会话 ID，刷新仍在 Service 中验证请求体里的 Refresh Token，其他业务接口默认需要有效会话。

服务端当前监听 `127.0.0.1`，适用于本机访问或同机反向代理；部署到容器或需要外部直连时，需要根据部署方式调整 `main.ts` 中的监听地址。

`AppModule` 通过 `nestjs-pino` 的 `LoggerModule` 注册请求日志，`main.ts` 将 Nest 应用日志交给 Pino，配置集中在 `config/logger.ts`。请求日志以 JSON 输出，包含请求 ID、方法、去除查询参数的路径、最终状态码和 `responseTime`（毫秒）；响应完成日志只记录一次。成功请求使用 `info`，4xx 使用 `warn`，5xx 或请求错误使用 `error`。请求、响应序列化仅保留这些元信息，不记录请求体、请求头、响应头或查询参数。业务代码继续使用 `@nestjs/common` 的 `Logger`，请求处理期间的业务日志会自动关联当前请求 ID。

### Prisma 数据模型与迁移

`apps/server/prisma/schema.prisma` 定义数据模型和 Client 生成配置；`apps/server/prisma.config.ts` 加载根目录 `.env`，配置数据库地址和迁移目录。Client 生成到 `apps/server/src/generated/prisma`，随服务端 `vp pack` 打包到 `dist`。安装依赖、服务端开发、构建和类型检查时会自动生成 Client，也可以手动执行 `pnpm db:generate`；这些操作不会创建数据库表或应用迁移。

目前 schema 定义 `User` 用户模型，`authVersion` 用于改密撤销会话；会话存放在 Redis，不再使用 PostgreSQL `Session` 表。首次部署执行 `pnpm db:deploy`；以后新增或调整 `model` 后，在本地数据库可用时执行：

```bash
pnpm db:migrate --name <name>
pnpm db:generate
```

将 `<name>` 替换为本次变更的名称。开发迁移会生成 SQL 文件并应用到本地数据库；提交 schema 和 `apps/server/prisma/migrations` 中的迁移文件，生成的 Client 不提交。Prisma 7 的 `migrate dev` 不会自动重新生成 Client，因此 schema 变更后需要生成并重启服务端，详见 [Prisma CLI 文档](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#migrate-dev)。

业务模块继续导入 `DatabaseModule` 并注入 `DatabaseService`，即可使用生成的模型查询方法。部署时先配置目标数据库的 `DATABASE_URL`，再执行 `pnpm db:deploy` 应用已提交的迁移，随后启动服务。

## 编译约定

### 共享认证状态

前端使用 Zustand 的 `useAuthStore` 管理双 Token，无需在入口添加 Provider。通过 `persist` 与 `createJSONStorage` 将 Access Token（存储字段 `token`）及 `refreshToken` 一起持久化到 `localStorage`，不使用 Cookie。恢复存储后仍需服务端验证，后台布局加载前会通过 `/user/info` 或刷新接口确认登录状态。

```tsx
import { useAuthStore } from '@/stores/auth';

// 组件订阅状态
const token = useAuthStore((state) => state.token);
// 登录成功后写入，退出时清除；组件外也可以调用
const { getToken, setSession, clearToken } = useAuthStore.getState();
setSession({ accessToken, refreshToken });
getToken(); // 每次调用读取最新值，解构方法后也不会使用旧快照
clearToken();
```

`api/http.ts` 使用 alova 的 `createServerTokenAuthentication`：普通请求携带最新 Access Token，收到 HTTP 401 时由内置队列合并刷新请求，更新两个 Token 后仅重试原请求一次；刷新期间新发起的普通请求会等待刷新完成。注册、登录和刷新不携带 Bearer 请求头，退出请求使用已捕获的 Access Token 且不发送请求体。默认禁用 GET 响应缓存和请求共享。认证接口自身不会触发自动刷新；退出收到 HTTP 401 时由 `auth/session.ts` 在会话锁内刷新凭证，再重试退出一次。Refresh Token 失效时清除登录状态并返回登录页，网络或服务端故障保留状态以便重试。会话版本用于避免旧响应覆盖新登录；退出会等待正在进行的刷新结束，再使用最新 Access Token 撤销会话。

多个标签页通过 `storage` 事件同步登录状态，并在刷新和退出前重读持久化凭证。刷新、退出和登录状态提交在每个标签页内串行执行；支持 Web Locks 的浏览器中（HTTPS 或 localhost）还使用同一个跨标签页锁，避免同时轮换同一 Refresh Token。未提供 Web Locks 时仍保留单标签请求合并与旧响应保护。

`patches/alova@3.5.5.patch` 修复当前版本内置刷新队列的失败传播和重试结果处理：刷新失败时所有等待请求都会结束，重试成功返回 `null`、`false`、`0`、空字符串或 204 时也能正确返回；同时避免旧重试清空下一轮刷新队列，并在重试结束后恢复响应转换函数。补丁通过 pnpm 自动应用。升级 alova 时需运行 `tests/api/http.test.ts` 中的回归测试，确认上游修复后再移除补丁。

### TypeScript 与构建

前端 TypeScript 按运行环境拆分：`tsconfig.app.json` 检查浏览器源码，`tsconfig.node.json` 检查 Vite 配置，`tsconfig.test.json` 检查测试与初始化文件。`tsconfig.json` 统一引用三个配置，`pnpm typecheck` 通过 `vp check --no-fmt --no-lint` 检查这些环境。

前端的 `@/` 指向 `apps/web/src/`，例如 `import { http } from '@/api/http'`。TypeScript 配置与 Vite / Vitest 使用相同的映射，跨目录导入使用别名，同目录可保留相对路径。workspace 共享类型继续通过 `@nestjs-agent/shared` 导入。

类型检查统一使用 `vp check` 内置的 TypeScript Go / tsgolint 路径，根目录 `lint.options` 已开启 `typeAware` 和 `typeCheck`。前端使用 Vite 8 构建；NestJS 服务端使用 `vp pack`（内置 tsdown）构建，输出 Node.js ESM。服务端类型检查采用 `NodeNext` 模块解析，相对导入使用 `.js` 扩展名，`vpx` 开发运行时会解析到对应的 `.ts` 源文件。

服务端启用 `experimentalDecorators` 和 `emitDecoratorMetadata`，`vpx` 运行源码和 `vp pack` 构建时均生成装饰器元数据，入口加载 `reflect-metadata`，NestJS 可根据构造函数参数类型自动注入依赖。接口、自定义 token 等依赖仍需使用 `@Inject(Token)` 显式声明。

服务端开发命令先生成 Prisma Client，再使用 `vpx --watch` 直接运行 `src/main.ts`，源码变更时重启服务，无需先写入 `dist`。`vpx` 不执行类型检查，类型错误通过 `pnpm typecheck` 或 `pnpm check` 检查；`pnpm build` 先检查类型，再构建，VP 构建会清理 `dist`。构建后通过 `pnpm --filter @nestjs-agent/server start` 使用 `vpx` 运行 `dist/main.js`。

Vite+ 的 `vp check` 集成 Oxlint、Oxfmt 和 TypeScript 类型检查；`--no-fmt --no-lint` 只保留类型检查。相关规则集中在根目录 `vite.config.ts`，从子包运行时也会使用根目录的静态检查配置。

Cursor / VS Code 请安装项目推荐的官方 Oxc 扩展（`oxc.oxc-vscode`）。项目已配置保存时使用 Oxfmt，与 `pnpm format` 共用根目录 `vite.config.ts` 的单引号规则。

## Git 提交检查

安装依赖时，`prepare` 通过 `vp config` 启用 Vite+ hooks。直接下载项目目录而非通过 Git 克隆时，先执行 `git init`，再执行 `pnpm prepare`。

- `pre-commit`：`vp staged` 只处理暂存文件，使用 Oxfmt 自动格式化，使用 Oxlint 检查 JavaScript / TypeScript；格式化结果自动加入暂存区，检查失败则阻止提交。
- `commit-msg`：commitlint 按 Conventional Commits 校验提交信息。
- `pre-push`：运行 `pnpm typecheck`，使用 `vp check` 检查整个 workspace 的类型，失败则阻止推送。

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
| API 无法启动或 Nginx 代理连接失败              | 检查后端日志、3000 端口和 Nginx 状态；修改 `.env` 的 `PORT` 时同步 `nginx.conf`，重启后端并重新加载 Nginx 配置        |
| 开发页面或 API 请求失败                        | 从 `http://localhost:8080` 打开页面，并确认 Nginx、Vite 和 NestJS 均运行；直接打开 5173 不会经过 Nginx 的 API 代理    |
| 修改 Compose 账号或密码后连接失败              | 已有数据卷保留原有数据库配置；使用原有凭据连接并修改数据库账号，同时同步 `.env`                                       |
| 生产环境刷新 `/health` 返回 404                | 检查静态服务器是否将前端路由回退到 `index.html`，并为 `/api` 单独配置反向代理                                         |
