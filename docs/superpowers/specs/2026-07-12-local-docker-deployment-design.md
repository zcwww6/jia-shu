# 家书星球完全本地 Docker 部署设计

**日期**：2026-07-12

**状态**：已完成方案讨论，等待书面规格审阅

## 1. 目标

将家书星球的部署策略从“国内云服务器 + 云 RDS PostgreSQL”调整为单机本地 Docker 部署，使应用、反向代理、数据库、迁移和数据备份都可在一台安装了 Docker Desktop 或 Docker Engine 的机器上运行。

部署完成后，使用者应能通过一组可复制的 Docker Compose 命令完成首次启动、升级、停止、备份和恢复，不再依赖云服务器或云数据库。

## 2. 已确认边界

本设计采用“本地基础设施 + 可选外部应用服务”的边界：

- Next.js、PostgreSQL、Nginx、Prisma migration 和数据库备份全部在本机运行。
- PostgreSQL 数据保存在 Docker named volume 中。
- OpenAI API 可继续通过网络调用；未配置时沿用项目已有 Mock fallback。
- Resend 继续承担 Magic Link 邮件投递，因此登录邮件需要联网。
- 不引入云服务器、云 RDS、Vercel KV 或其他远程主存储。
- 不要求 AI 模型和邮件系统离线运行。
- 不在本阶段引入 Mailpit、Nodemailer 或新的认证 Provider。

## 3. 当前基线

设计基线为分支 `feature/launch-foundation-phase1-auth-persistence` 的提交 `07950a0`。该基线已经包含：

- Next.js 16 App Router 应用；
- Auth.js + Resend Magic Link；
- Prisma 7 + PostgreSQL Schema；
- User、Galaxy、Planet、SharedBook 持久化模型；
- 数据库主路径的分享发布与读取；
- 19 个测试文件、68 个测试；
- 通过 lint 和生产构建的历史验证。

当前缺失：

- Prisma baseline migration；
- Dockerfile、Compose 和 `.dockerignore`；
- Nginx 配置；
- live/ready 健康检查；
- 本地 Docker 环境变量模板；
- 数据库备份与恢复流程；
- 与新策略一致的部署文档。

## 4. 方案比较与决策

### 4.1 方案一：App + PostgreSQL

直接暴露 Next.js 的 3000 端口。该方案文件少、启动快，但缺少统一入口、代理头、请求体限制和稳定的认证规范地址，只适合作为开发覆盖层。

### 4.2 方案二：Nginx + App + Migration + PostgreSQL

Nginx 是唯一入口；App 与 PostgreSQL 只在 Compose 网络中通信；一次性 Migration 服务负责数据库升级；PostgreSQL 使用 named volume。

**决策：采用该方案。**

它保持服务职责独立，支持可靠的数据生命周期，且无需改变现有 Auth.js、OpenAI 或业务代码边界。

### 4.3 方案三：加入 Mailpit

Mailpit 可捕获本地邮件，但当前认证代码使用 Resend Provider。仅添加 Mailpit 容器不能完成登录，必须额外引入 SMTP Provider 和认证配置切换，超出本阶段范围。

## 5. 总体架构

```text
浏览器
  |
  v
nginx:80
  |
  v
app:3000 -----------------> OpenAI API（可选联网）
  |                         Resend（登录邮件，联网）
  v
postgres:5432
  ^
  |
migrate（一次性任务）
```

### 5.1 `nginx`

职责：

- 发布宿主机端口；
- 将请求转发给 App；
- 传递 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`；
- 配置请求体大小、连接超时和代理超时；
- 通过 App 的 live 接口执行健康检查。

Nginx 是默认配置中唯一发布宿主机端口的服务。

### 5.2 `app`

职责：

- 运行 Next.js standalone 生产服务；
- 连接 Compose 网络中的 PostgreSQL；
- 调用可选的 OpenAI 和 Resend 外部 API；
- 提供 live 和 ready 健康接口。

App 镜像使用多阶段构建，运行阶段只复制 standalone 产物、静态资源和运行所需的 Prisma Client，并以非 root 用户运行。

### 5.3 `migrate`

职责：

- 使用与 App 同源的构建产物；
- 等待 PostgreSQL healthy；
- 执行 `prisma migrate deploy`；
- 成功后以 0 退出，失败时阻止 App 进入正常启动链路。

迁移不在 App entrypoint 内执行，也不使用 `prisma db push` 或 `prisma migrate dev` 启动正式栈。

### 5.4 `postgres`

职责：

- 使用固定版本的 PostgreSQL 官方镜像；
- 使用 named volume 保存 `PGDATA`；
- 通过 `pg_isready` 提供健康状态；
- 将备份文件写入宿主机 `./backups`。

正式 Compose 不发布 5432。开发覆盖配置可以临时映射 `127.0.0.1:5432`，禁止映射到所有网卡。

## 6. 文件职责

### 新增文件

- `Dockerfile`：pnpm 依赖、构建、migration 和非 root runtime 阶段。
- `.dockerignore`：排除 Git、node_modules、Next 构建产物、worktree、本地环境变量、备份和本地数据。
- `compose.yaml`：定义 nginx、app、migrate、postgres、网络、健康检查和 named volume。
- `compose.dev.yaml`：仅提供开发所需的数据库 localhost 端口映射等覆盖项。
- `docker/nginx/default.conf`：反向代理、代理头、超时、请求体限制和健康检查路径。
- `.env.docker.example`：本地 Docker 部署变量模板，不包含真实密钥。
- `src/app/api/health/live/route.ts`：仅验证应用进程存活。
- `src/app/api/health/ready/route.ts`：通过 Prisma 轻量查询验证数据库就绪。
- `src/app/api/health/ready/route.test.ts`：验证数据库成功与失败响应。
- `prisma/migrations/<timestamp>_auth_persistence_baseline/migration.sql`：基线建表 SQL。
- `prisma/migrations/migration_lock.toml`：锁定 PostgreSQL provider。

### 修改文件

- `next.config.ts`：启用 `output: "standalone"`。
- `src/server/config/env.ts`：纳入 Docker 认证规范地址所需配置，并保持运行时读取。
- `src/server/config/env.test.ts`：覆盖本地 Docker 环境变量。
- `README.md`：更新本地启动、验证、停止、升级和数据保护说明。
- `产品开发文档/2026-07-04-部署与数据库方案.md`：将云服务器/RDS 方案标记为被本设计替代，并指向本地 Docker 文档。

## 7. 数据与迁移生命周期

### 7.1 首次启动

1. Docker 创建 PostgreSQL named volume。
2. PostgreSQL 初始化用户和数据库并进入 healthy。
3. Migration 服务执行已提交的 baseline migration。
4. Migration 成功后 App 启动并通过 ready 检查。
5. Nginx 将应用开放在 `http://localhost`。

### 7.2 日常停止与重启

- `docker compose stop` 停止服务并保留容器和数据。
- `docker compose down` 删除容器和网络，但保留 named volume。
- `docker compose down -v` 会删除数据库数据，不作为日常命令，并在文档中使用醒目警告。

### 7.3 版本升级

1. 升级前创建数据库备份。
2. 构建新 App 镜像。
3. 执行 `prisma migrate deploy`。
4. 启动新 App。
5. 验证 ready、登录、星系和分享链路。

Migration 文件必须随代码提交。正式 Compose 不生成 migration。

## 8. 环境变量与认证地址

提交 `.env.docker.example`，本机复制为不提交的 `.env.docker`。

容器中的数据库连接使用 Compose 服务名：

```env
DATABASE_URL=postgresql://jiashu:<local-password>@postgres:5432/jiashu
```

必须配置：

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `AUTH_SECRET`
- `AUTH_RESEND_API_KEY`
- `AUTH_RESEND_FROM`
- `AUTH_URL`
- `AUTH_TRUST_HOST=true`

可选配置：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`

仅本机访问时 `AUTH_URL=http://localhost`。局域网访问时必须换成其他设备可达的固定 IP 或主机名，否则邮件中的 Magic Link 无法从其他设备打开。

密钥只在容器运行时注入，不作为 Docker build argument，不复制进镜像，也不提交到 Git。

## 9. 健康检查与错误处理

### 9.1 Live

`GET /api/health/live` 不访问数据库，应用进程可响应时返回 200。

### 9.2 Ready

`GET /api/health/ready` 通过 Prisma 执行轻量数据库查询：

- 数据库正常时返回 200；
- 数据库连接失败时返回 503；
- 响应不包含连接串、凭证或内部堆栈。

数据库短暂不可用只会让 App 进入 not-ready，不因 ready 失败不断重启 App。容器自身的存活检查使用 live，依赖就绪判断使用 ready。

### 9.3 外部服务错误

- OpenAI 未配置时沿用 Mock fallback。
- OpenAI 已配置但调用失败时沿用应用现有错误处理，并在后续业务治理中补充可观察性。
- Resend 不可用时登录请求必须显示明确错误，不能返回假成功。
- 外部服务错误不应阻止 PostgreSQL、App 和 Nginx 启动。

## 10. 备份与恢复

Named volume 只解决容器重建时的数据保留，不等同于备份。

### 10.1 备份

- 将宿主机 `./backups` 挂载为 PostgreSQL 容器内的 `/backups`。
- 使用容器内 `pg_dump -Fc` 直接写备份文件，避免 PowerShell 二进制管道损坏备份。
- 每次重要升级前和重要演示数据录入后执行备份。
- 至少把关键备份复制到第二块物理磁盘或 NAS；同一磁盘无法抵御磁盘故障。

### 10.2 恢复

1. 停止 App 写入。
2. 备份当前数据库。
3. 使用 `pg_restore --clean --if-exists --no-owner` 恢复指定文件。
4. 执行 `prisma migrate deploy`。
5. 启动 App 并验证 ready。
6. 验证登录、星系、发布和跨浏览器分享。

备份和恢复命令必须在正式交付前完成一次真实演练。

## 11. Windows 与 Linux 兼容性

- Windows 使用 Docker Desktop Linux containers。
- Linux 使用 Docker Engine 和 Compose plugin。
- PostgreSQL `PGDATA` 使用 named volume，不 bind mount 到 Windows 文件系统。
- Nginx 配置和 `./backups` 可以使用相对路径 bind mount。
- 使用固定且支持目标架构的官方镜像 tag，不使用 `latest`。
- Dockerfile 中的文本文件保持 LF。
- 尽量使用 Compose command，减少依赖宿主机 shell 的脚本。

## 12. 测试与验收

### 12.1 自动验证

- `npx pnpm prisma generate`
- `npx pnpm test`
- `npx pnpm lint`
- `npx pnpm build`
- `docker compose config`
- `docker compose build --pull`
- `docker compose up -d`
- `docker compose ps`
- 检查 Migration 容器以 0 退出。
- 检查 PostgreSQL、App 和 Nginx 健康状态。

### 12.2 业务验收

1. 访问 `http://localhost`。
2. 通过 Resend Magic Link 登录。
3. 进入 `/galaxy`。
4. 发布家书并获得 `/share/[token]`。
5. 在另一浏览器中打开分享地址。
6. 重启 App 和 PostgreSQL 后再次访问数据。
7. 执行一次备份。
8. 恢复备份并再次验证登录、星系和分享。

### 12.3 安全验收

- PostgreSQL 未发布到外部网卡。
- App 端口未直接发布。
- App 进程不是 root。
- 镜像中不存在 `.env.docker` 或真实密钥。
- Nginx 正确转发 Host 和协议头。
- ready 错误响应不泄漏数据库信息。

## 13. 成功标准

满足以下条件时，本地 Docker 部署才可标记为完成：

1. 新机器从空环境按 README 可启动完整栈。
2. 空数据库可通过已提交 migration 初始化。
3. 日常重建容器不会丢失数据。
4. 登录、星系、发布和分享路径可用。
5. OpenAI 未配置时应用仍可演示。
6. 已完成真实备份与恢复演练。
7. `test`、`lint`、`build` 和 Compose 检查全部通过。
8. 文档不再把云服务器或云 RDS 描述为当前部署方向。

## 14. 后续可选增强

以下内容不属于本设计的实施范围：

- Mailpit + SMTP Provider 的离线登录开发模式；
- 本地 HTTPS 和自动生成开发证书；
- 局域网自动发现；
- 数据库定时备份调度；
- Docker 镜像漏洞扫描流水线；
- 本地大模型运行。

这些增强应在基础本地部署完成并通过恢复演练后单独评估。
