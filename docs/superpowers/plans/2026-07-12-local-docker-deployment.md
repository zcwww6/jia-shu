

# 家书星球完全本地 Docker 部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将家书星球的 Next.js、PostgreSQL、Prisma migration 和 Nginx 完整封装为可在单机运行、升级、备份和恢复的 Docker Compose 栈，不再依赖云服务器或云 RDS。

**Architecture:** Nginx 是唯一宿主机入口，Next.js standalone App 与 PostgreSQL 仅通过 Compose 网络通信；一次性 migrate 服务在 App 启动前执行已提交的 Prisma migration。PostgreSQL 使用 named volume，备份写入宿主机 backups 目录；OpenAI 与 Resend 保留为可选联网依赖。

**Tech Stack:** Docker Engine / Docker Desktop、Docker Compose、Node.js 22、pnpm 11.8、Next.js 16 standalone、Prisma 7、PostgreSQL 17、Nginx 1.28、Vitest。

---

## 执行基线

- 在独立分支和 worktree 中执行，不要直接修改带未提交改动的 develop。
- 基线分支：feature/launch-foundation-phase1-auth-persistence。
- 基线提交：07950a0。
- 已批准设计：docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md。
- 每次提交只包含当前任务列出的文件。
- Docker Desktop 必须处于 Linux containers 模式。

开始 Task 1 前运行：

~~~powershell
docker info
docker compose version
npx pnpm prisma generate
npx pnpm test
~~~

Expected: Docker Server 可访问、Compose 版本可显示、19 个测试文件和 68 个测试通过。若 docker info 失败，先启动 Docker Desktop 并重新运行本门禁；不要在 Docker daemon 不可用时继续容器任务。

## 最终文件结构

新增：

- Dockerfile：依赖、构建、迁移、运行四阶段镜像。
- .dockerignore：限制构建上下文并排除密钥、备份和 worktree。
- compose.yaml：postgres、migrate、app、nginx 及网络、volume、健康检查。
- compose.dev.yaml：仅将 PostgreSQL 发布到 127.0.0.1，供生成 migration 和本地调试。
- docker/nginx/default.conf：反向代理和代理头。
- .env.docker.example：本地 Compose 变量模板。
- src/app/api/health/live/route.ts：进程存活检查。
- src/app/api/health/ready/route.ts：数据库就绪检查。
- src/app/api/health/ready/route.test.ts：ready 成功与失败测试。
- prisma/migrations/20260712000000_auth_persistence_baseline/migration.sql：当前 Prisma Schema 的基线迁移。
- prisma/migrations/migration_lock.toml：PostgreSQL migration provider 锁。

修改：

- next.config.ts：启用 standalone 输出。
- src/server/config/env.ts：类型化读取 AUTH_URL 和 AUTH_TRUST_HOST。
- src/server/config/env.test.ts：覆盖 Docker 认证配置。
- README.md：本地 Docker 启停、迁移、升级、备份、恢复。
- 产品开发文档/2026-07-04-部署与数据库方案.md：标记云部署方案已被替代。

---

### Task 1: 固化 Docker 运行时配置和 standalone 构建

**Files:**

- Modify: next.config.ts
- Modify: src/server/config/env.ts
- Modify: src/server/config/env.test.ts

- [ ] **Step 1: 为 Docker 认证地址写失败测试**

在 src/server/config/env.test.ts 的 “reads required auth/database settings and optional AI settings” 用例中，把输入对象扩展为：

~~~ts
const result = loadAppEnv({
  DATABASE_URL: "postgresql://demo",
  AUTH_SECRET: "secret",
  AUTH_RESEND_API_KEY: "re_test",
  AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
  AUTH_URL: "http://localhost",
  AUTH_TRUST_HOST: "true",
  OPENAI_API_KEY: "sk-demo",
  OPENAI_MODEL: "gpt-5.4-mini",
});
~~~

在同一用例中加入：

~~~ts
expect(result.AUTH_URL).toBe("http://localhost");
expect(result.AUTH_TRUST_HOST).toBe(true);

process.env.AUTH_URL = "http://localhost";
process.env.AUTH_TRUST_HOST = "true";

expect(env.AUTH_URL).toBe("http://localhost");
expect(env.AUTH_TRUST_HOST).toBe(true);
~~~

在 “throws when required settings are missing” 用例中加入：

~~~ts
expect(() =>
  loadAppEnv({
    DATABASE_URL: "postgresql://demo",
    AUTH_SECRET: "secret",
    AUTH_RESEND_API_KEY: "re_test",
    AUTH_RESEND_FROM: "Jiashu <noreply@example.com>",
  }),
).toThrow("AUTH_URL");
~~~

- [ ] **Step 2: 运行环境配置测试并确认失败**

Run:

~~~powershell
npx pnpm vitest run src/server/config/env.test.ts
~~~

Expected: FAIL，AUTH_URL 或 AUTH_TRUST_HOST 尚未出现在返回值中。

- [ ] **Step 3: 实现严格布尔值和认证地址读取**

在 src/server/config/env.ts 的 required 函数后增加：

~~~ts
function requiredBoolean(source: EnvSource, key: keyof EnvSource) {
  const value = required(source, key);
  if (value !== "true" && value !== "false") {
    throw new Error(\`Invalid boolean env: \${String(key)}\`);
  }
  return value === "true";
}
~~~

在 loadAppEnv 返回对象中，紧跟 AUTH_RESEND_FROM 增加：

~~~ts
AUTH_URL: required(source, "AUTH_URL"),
AUTH_TRUST_HOST: requiredBoolean(source, "AUTH_TRUST_HOST"),
~~~

在 env 对象中，紧跟 AUTH_RESEND_FROM getter 增加：

~~~ts
get AUTH_URL() {
  return required(process.env, "AUTH_URL");
},
get AUTH_TRUST_HOST() {
  return requiredBoolean(process.env, "AUTH_TRUST_HOST");
},
~~~

- [ ] **Step 4: 启用 Next.js standalone 输出**

将 next.config.ts 替换为：

~~~ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
~~~

- [ ] **Step 5: 验证测试和 standalone 构建**

Run:

~~~powershell
npx pnpm vitest run src/server/config/env.test.ts
npx pnpm build
Test-Path ".next/standalone/server.js"
~~~

Expected: 环境测试 PASS，构建成功，最后输出 True。

- [ ] **Step 6: 提交运行时配置**

~~~powershell
git add next.config.ts src/server/config/env.ts src/server/config/env.test.ts
git commit -m "chore: prepare standalone docker runtime"
~~~

---

### Task 2: 添加 live 与 ready 健康检查

**Files:**

- Create: src/app/api/health/live/route.ts
- Create: src/app/api/health/ready/route.ts
- Create: src/app/api/health/ready/route.test.ts

- [ ] **Step 1: 写 ready 路由失败测试**

创建 src/app/api/health/ready/route.test.ts：

~~~ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  getPrismaClient: () => ({
    $queryRaw: queryRaw,
  }),
}));

import { GET } from "./route";

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns 200 when PostgreSQL is reachable", async () => {
    queryRaw.mockResolvedValue([{ ready: 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("returns 503 without leaking database errors", async () => {
    queryRaw.mockRejectedValue(new Error("password=secret"));

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "not_ready" });
    expect(JSON.stringify(body)).not.toContain("password");
  });
});
~~~

- [ ] **Step 2: 运行测试并确认路由不存在**

Run:

~~~powershell
npx pnpm vitest run src/app/api/health/ready/route.test.ts
~~~

Expected: FAIL，无法解析 ./route。

- [ ] **Step 3: 实现 ready 路由**

创建 src/app/api/health/ready/route.ts：

~~~ts
import { NextResponse } from "next/server";

import { getPrismaClient } from "@/server/db/client";

export async function GET() {
  try {
    await getPrismaClient().$queryRaw\`SELECT 1 AS ready\`;
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
~~~

- [ ] **Step 4: 实现无数据库依赖的 live 路由**

创建 src/app/api/health/live/route.ts：

~~~ts
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
~~~

- [ ] **Step 5: 验证健康路由**

Run:

~~~powershell
npx pnpm vitest run src/app/api/health/ready/route.test.ts
npx pnpm build
~~~

Expected: 2 tests PASS；构建路由清单包含 /api/health/live 和 /api/health/ready。

- [ ] **Step 6: 提交健康检查**

~~~powershell
git add src/app/api/health
git commit -m "feat: add container health endpoints"
~~~

---

### Task 3: 构建安全的 Next.js 多阶段镜像

**Files:**

- Create: Dockerfile
- Create: .dockerignore

- [ ] **Step 1: 验证缺少镜像定义**

Run:

~~~powershell
docker build --target runtime -t jiashu-app:plan-check .
~~~

Expected: FAIL，找不到 Dockerfile。

- [ ] **Step 2: 创建多阶段 Dockerfile**

创建 Dockerfile：

~~~dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22.17-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM node:22.17-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
~~~

- [ ] **Step 3: 限制 Docker 构建上下文**

创建 .dockerignore：

~~~text
.git
.github
.worktrees
.agents
.claude
.next
node_modules
coverage
backups
.local-data
.env
.env.*
!.env.example
!.env.docker.example
*.log
docs/superpowers
历史资料
~~~

- [ ] **Step 4: 构建 runtime 和 migrate target**

Run:

~~~powershell
docker build --target runtime -t jiashu-app:local .
docker build --target migrate -t jiashu-migrate:local .
docker image inspect jiashu-app:local --format '{{.Config.User}}'
~~~

Expected: 两个镜像构建成功，最后输出 nextjs 或 1001。

- [ ] **Step 5: 验证镜像没有环境文件**

Run:

~~~powershell
docker run --rm --entrypoint sh jiashu-app:local -c "test ! -f /app/.env.docker && test ! -f /app/.env.local"
~~~

Expected: exit code 0。

- [ ] **Step 6: 提交镜像定义**

~~~powershell
git add Dockerfile .dockerignore
git commit -m "build: add standalone nextjs container"
~~~

---

### Task 4: 编排 PostgreSQL、Migration 和 App

**Files:**

- Create: compose.yaml
- Create: compose.dev.yaml
- Create: .env.docker.example
- Modify: .gitignore

- [ ] **Step 1: 验证 Compose 配置尚不存在**

Run:

~~~powershell
docker compose --env-file .env.docker.example config
~~~

Expected: FAIL，找不到 Compose 配置或环境文件。

- [ ] **Step 2: 允许提交 Docker 环境变量模板**

在 .gitignore 的 !.env.example 后增加：

~~~gitignore
!.env.docker.example
backups/
~~~

Run:

~~~powershell
git check-ignore .env.docker.example
git check-ignore --no-index backups/
~~~

Expected: 第一条无输出且 exit code 1，表示模板不会被忽略；第二条输出 backups，表示数据库备份不会进入 Git。

- [ ] **Step 3: 创建本地环境变量模板**

创建 .env.docker.example：

~~~dotenv
POSTGRES_DB=jiashu
POSTGRES_USER=jiashu
POSTGRES_PASSWORD=example-only-change-before-use
DATABASE_URL=postgresql://jiashu:example-only-change-before-use@postgres:5432/jiashu

AUTH_SECRET=example-only-generate-with-openssl-rand-base64-32
AUTH_URL=http://localhost
AUTH_TRUST_HOST=true
AUTH_RESEND_API_KEY=re_example_only_change_before_use
AUTH_RESEND_FROM="家书星球 <noreply@example.com>"

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://api.openai.com/v1
~~~

- [ ] **Step 4: 创建正式 Compose**

创建 compose.yaml：

~~~yaml
name: jiashu

services:
  postgres:
    image: postgres:17.5-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:?POSTGRES_DB is required}
      POSTGRES_USER: \${POSTGRES_USER:?POSTGRES_USER is required}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 12

  migrate:
    build:
      context: .
      target: migrate
    environment:
      DATABASE_URL: \${DATABASE_URL:?DATABASE_URL is required}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - backend
    restart: "no"

  app:
    build:
      context: .
      target: runtime
    restart: unless-stopped
    environment:
      DATABASE_URL: \${DATABASE_URL:?DATABASE_URL is required}
      AUTH_SECRET: \${AUTH_SECRET:?AUTH_SECRET is required}
      AUTH_URL: \${AUTH_URL:?AUTH_URL is required}
      AUTH_TRUST_HOST: \${AUTH_TRUST_HOST:-true}
      AUTH_RESEND_API_KEY: \${AUTH_RESEND_API_KEY:?AUTH_RESEND_API_KEY is required}
      AUTH_RESEND_FROM: \${AUTH_RESEND_FROM:?AUTH_RESEND_FROM is required}
      OPENAI_API_KEY: \${OPENAI_API_KEY:-}
      OPENAI_MODEL: \${OPENAI_MODEL:-gpt-5.4-mini}
      OPENAI_BASE_URL: \${OPENAI_BASE_URL:-https://api.openai.com/v1}
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks:
      - frontend
      - backend
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))
      interval: 10s
      timeout: 5s
      start_period: 20s
      retries: 6

  nginx:
    image: nginx:1.28-alpine
    restart: unless-stopped
    ports:
      - "80:80"
    volumes:
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      app:
        condition: service_healthy
    networks:
      - frontend

networks:
  frontend:
  backend:
    internal: true

volumes:
  postgres_data:
~~~

- [ ] **Step 5: 创建开发数据库端口覆盖**

创建 compose.dev.yaml：

~~~yaml
services:
  postgres:
    ports:
      - "127.0.0.1:5432:5432"
~~~

- [ ] **Step 6: 创建本机私有环境文件并检查配置**

Run:

~~~powershell
Copy-Item .env.docker.example .env.docker
docker compose --env-file .env.docker config
docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml config
~~~

Expected: 两次 config 均成功；正式配置只有 Nginx 发布 80，开发覆盖额外发布 127.0.0.1:5432。

- [ ] **Step 7: 确认私有环境文件未被跟踪**

Run:

~~~powershell
git check-ignore .env.docker
~~~

Expected: 输出 .env.docker。

- [ ] **Step 8: 提交 Compose 编排**

~~~powershell
git add .gitignore compose.yaml compose.dev.yaml .env.docker.example
git commit -m "build: add local compose services"
~~~

---

### Task 5: 配置 Nginx 唯一入口

**Files:**

- Create: docker/nginx/default.conf
- Modify: compose.yaml

- [ ] **Step 1: 验证 Nginx 配置缺失**

Run:

~~~powershell
if (-not (Test-Path "docker/nginx/default.conf")) { throw "docker/nginx/default.conf is missing" }
~~~

Expected: FAIL，抛出配置缺失错误。

- [ ] **Step 2: 创建反向代理配置**

创建 docker/nginx/default.conf：

~~~nginx
upstream jiashu_app {
    server app:3000;
    keepalive 16;
}

server {
    listen 80;
    server_name _;
    client_max_body_size 20m;

    location / {
        proxy_pass http://jiashu_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 10s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
~~~

- [ ] **Step 3: 为 Nginx 增加代理后的 live 健康检查**

在 compose.yaml 的 nginx 服务中，紧跟 networks 增加：

~~~yaml
    healthcheck:
      test:
        - CMD-SHELL
        - wget -qO- http://127.0.0.1/api/health/live >/dev/null || exit 1
      interval: 10s
      timeout: 5s
      start_period: 10s
      retries: 6
~~~

- [ ] **Step 4: 验证 Nginx 语法和 Compose**

Run:

~~~powershell
docker run --rm -v "\${PWD}/docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.28-alpine nginx -t
docker compose --env-file .env.docker config
~~~

Expected: nginx 输出 syntax is ok 和 test is successful；Compose config 成功。

- [ ] **Step 5: 提交 Nginx 配置**

~~~powershell
git add docker/nginx/default.conf compose.yaml
git commit -m "build: add nginx local gateway"
~~~

---

### Task 6: 生成并验证 Prisma baseline migration

**Files:**

- Create: prisma/migrations/20260712000000_auth_persistence_baseline/migration.sql
- Create: prisma/migrations/migration_lock.toml

- [ ] **Step 1: 启动仅供迁移生成使用的本地 PostgreSQL**

Run:

~~~powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml up -d postgres
docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml exec postgres pg_isready -U jiashu -d jiashu
~~~

Expected: PostgreSQL healthy，pg_isready 输出 accepting connections。

- [ ] **Step 2: 确认正式迁移当前不存在**

Run:

~~~powershell
$env:DATABASE_URL = "postgresql://jiashu:example-only-change-before-use@127.0.0.1:5432/jiashu"
npx pnpm prisma migrate status
~~~

Expected: 提示尚无 migration 或数据库 schema 未由 migration 管理。

- [ ] **Step 3: 从当前 Schema 生成确定路径的 baseline SQL**

Run:

~~~powershell
New-Item -ItemType Directory -Force "prisma/migrations/20260712000000_auth_persistence_baseline"
npx pnpm prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output "prisma/migrations/20260712000000_auth_persistence_baseline/migration.sql"
~~~

Expected: migration.sql 创建成功，命令 exit code 0。

- [ ] **Step 4: 创建 migration provider 锁**

创建 prisma/migrations/migration_lock.toml：

~~~toml
provider = "postgresql"
~~~

- [ ] **Step 5: 审查 baseline SQL 的关键对象**

Run:

~~~powershell
$sql = Get-Content -Raw "prisma/migrations/20260712000000_auth_persistence_baseline/migration.sql"
$required = @('"User"', '"Account"', '"Session"', '"VerificationToken"', '"Galaxy"', '"Planet"', '"SharedBook"')
foreach ($table in $required) { if (-not $sql.Contains($table)) { throw "Migration is missing $table" } }
~~~

Expected: exit code 0；七张表和对应 enum、外键、唯一索引均可在 SQL 中看到。

- [ ] **Step 6: 用正式 migrate 服务从空卷应用两次**

此时测试卷尚未录入业务数据，可以安全清理：

~~~powershell
docker compose --env-file .env.docker down -v
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker run --rm migrate
~~~

Expected: 第一次创建表并记录 migration；第二次输出 No pending migrations 或同义结果。

- [ ] **Step 7: 验证 migration 状态**

Run:

~~~powershell
docker compose --env-file .env.docker run --rm migrate pnpm prisma migrate status
~~~

Expected: Database schema is up to date。

- [ ] **Step 8: 提交 baseline migration**

~~~powershell
git add prisma/migrations
git commit -m "feat: add auth persistence baseline migration"
~~~

---

### Task 7: 更新本地 Docker 运维文档

**Files:**

- Modify: README.md
- Modify: 产品开发文档/2026-07-04-部署与数据库方案.md

- [ ] **Step 1: 验证 README 尚未提供 Compose 启动命令**

Run:

~~~powershell
Select-String -Path README.md -Pattern "docker compose --env-file .env.docker up"
~~~

Expected: 无匹配结果。

- [ ] **Step 2: 将 README 的本地开发段落替换为本地 Docker 操作手册**

使用以下完整内容替换 README.md 中从 “## 本地开发” 到 “## 目录结构” 之前的内容：

~~~~markdown
## 本地 Docker 部署

### 环境要求

- Docker Desktop（Windows，Linux containers）或 Docker Engine
- Docker Compose plugin
- 可访问 Resend；如配置真实 AI，还需可访问 OpenAI 兼容接口

验证 Docker：

~~~powershell
docker info
docker compose version
~~~

### 首次启动

复制并编辑私有环境文件：

~~~powershell
Copy-Item .env.docker.example .env.docker
~~~

至少替换 POSTGRES_PASSWORD、DATABASE_URL、AUTH_SECRET、AUTH_RESEND_API_KEY 和 AUTH_RESEND_FROM。DATABASE_URL 中的密码必须与 POSTGRES_PASSWORD 相同，数据库主机必须保持 postgres。

启动完整栈：

~~~powershell
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs migrate
~~~

浏览器访问 http://localhost。

### 停止与重启

停止但保留容器：

~~~powershell
docker compose --env-file .env.docker stop
~~~

删除容器和网络但保留数据库 volume：

~~~powershell
docker compose --env-file .env.docker down
~~~

重新启动：

~~~powershell
docker compose --env-file .env.docker up -d
~~~

不要把 docker compose down -v 作为日常命令；-v 会删除 PostgreSQL 数据。

### 升级

升级前先备份，然后执行：

~~~powershell
docker compose --env-file .env.docker build --pull
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
~~~

### 数据库备份

创建备份目录后，让 pg_dump 在容器内直接写 custom-format 文件：

~~~powershell
New-Item -ItemType Directory -Force backups
docker compose --env-file .env.docker exec -T postgres pg_dump -U jiashu -d jiashu -Fc -f /backups/jiashu-manual.dump
~~~

named volume 不是备份。重要备份还应复制到第二块物理磁盘或 NAS。

### 数据库恢复

先停止 App 写入并备份当前数据库：

~~~powershell
docker compose --env-file .env.docker stop app nginx
docker compose --env-file .env.docker exec -T postgres pg_restore -U jiashu -d jiashu --clean --if-exists --no-owner /backups/jiashu-manual.dump
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d app nginx
~~~

恢复后验证 http://localhost/api/health/ready、登录、星系和分享链接。

### 本地源码开发

源码开发仍使用 .env.local 和 pnpm：

~~~powershell
npx pnpm install
npx pnpm prisma generate
npx pnpm dev
~~~

如需从宿主机连接 Compose PostgreSQL，使用开发覆盖配置：

~~~powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml up -d postgres
~~~

数据库只发布到 127.0.0.1:5432。

### 项目验证

~~~powershell
npx pnpm prisma generate
npx pnpm test
npx pnpm lint
npx pnpm build
docker compose --env-file .env.docker config
~~~
~~~~

保留原有 “## 目录结构” 及其后内容。

- [ ] **Step 3: 标记旧云部署文档已被替代**

在 产品开发文档/2026-07-04-部署与数据库方案.md 的标题后插入：

~~~markdown
> **状态：已被替代。** 自 2026-07-12 起，当前部署方向调整为完全本地 Docker Compose，不再使用云服务器或云 RDS。现行设计见 docs/superpowers/specs/2026-07-12-local-docker-deployment-design.md；本文件仅保留为历史决策记录。
~~~

- [ ] **Step 4: 检查文档中的当前方向**

Run:

~~~powershell
Select-String -Path README.md -Pattern "docker compose --env-file .env.docker up"
Select-String -Path "产品开发文档/2026-07-04-部署与数据库方案.md" -Pattern "已被替代"
~~~

Expected: 两条命令均有匹配结果。

- [ ] **Step 5: 提交运维文档**

~~~powershell
git add README.md "产品开发文档/2026-07-04-部署与数据库方案.md"
git commit -m "docs: document fully local docker operations"
~~~

---

### Task 8: 完整启动、持久化和恢复验收

**Files:**

- Verify: Dockerfile
- Verify: compose.yaml
- Verify: compose.dev.yaml
- Verify: docker/nginx/default.conf
- Verify: .env.docker.example
- Verify: prisma/migrations/20260712000000_auth_persistence_baseline/migration.sql
- Verify: src/app/api/health/live/route.ts
- Verify: src/app/api/health/ready/route.ts
- Verify: README.md

- [ ] **Step 1: 填入可用的本地私有配置**

编辑未跟踪的 .env.docker：

- POSTGRES_PASSWORD 使用新的随机本地密码。
- DATABASE_URL 使用完全相同的密码和 postgres 主机。
- AUTH_SECRET 使用 openssl rand -base64 32 生成。
- AUTH_RESEND_API_KEY 和 AUTH_RESEND_FROM 使用可投递的 Resend 配置。
- AUTH_URL 保持 http://localhost。
- AUTH_TRUST_HOST 保持 true。
- 不需要真实 AI 时保持 OPENAI_API_KEY 为空。

Run:

~~~powershell
git check-ignore .env.docker
docker compose --env-file .env.docker config
~~~

Expected: .env.docker 被忽略，Compose 配置有效且不会输出缺失变量错误。

- [ ] **Step 2: 运行全部代码质量门禁**

Run:

~~~powershell
npx pnpm prisma generate
npx pnpm test
npx pnpm lint
npx pnpm build
~~~

Expected: 19 个以上测试文件全部通过；lint 和 build exit code 0。

- [ ] **Step 3: 从空数据库启动完整栈**

仅当当前 Compose volume 没有需要保留的数据时执行：

~~~powershell
docker compose --env-file .env.docker down -v
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs migrate
~~~

Expected:

- postgres 为 healthy；
- migrate 以 code 0 退出；
- app 为 healthy；
- nginx 为 healthy；
- migrate 日志显示 baseline migration 已应用。

- [ ] **Step 4: 验证 live、ready 和 Nginx 入口**

Run:

~~~powershell
(Invoke-WebRequest http://localhost/api/health/live).Content
(Invoke-WebRequest http://localhost/api/health/ready).Content
(Invoke-WebRequest http://localhost).StatusCode
~~~

Expected: 分别包含 ok、ready，首页状态码为 200 或认证重定向后的最终 200。

- [ ] **Step 5: 完成真实业务 smoke test**

手工执行并记录结果：

1. 输入邮箱并收到 Resend Magic Link。
2. 点击链接进入 /galaxy。
3. 确认首次用户产生个人星系。
4. 生成并发布家书。
5. 复制 /share/[token]。
6. 使用隐身窗口访问分享链接。

Expected: 登录成功；Galaxy 和 SharedBook 写入 PostgreSQL；隐身窗口无需登录即可读取分享页。

- [ ] **Step 6: 验证容器重建不丢数据**

Run:

~~~powershell
docker compose --env-file .env.docker down
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
~~~

Expected: 服务恢复 healthy；Step 5 的用户、星系和分享链接仍存在。

- [ ] **Step 7: 执行真实备份与恢复演练**

Run:

~~~powershell
New-Item -ItemType Directory -Force backups
docker compose --env-file .env.docker exec -T postgres pg_dump -U jiashu -d jiashu -Fc -f /backups/jiashu-e2e.dump
Test-Path "backups/jiashu-e2e.dump"
docker compose --env-file .env.docker stop app nginx
docker compose --env-file .env.docker exec -T postgres pg_restore -U jiashu -d jiashu --clean --if-exists --no-owner /backups/jiashu-e2e.dump
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d app nginx
~~~

Expected: Test-Path 输出 True；恢复和 migration 成功；服务重新 healthy。

- [ ] **Step 8: 恢复后复验核心业务**

Run:

~~~powershell
(Invoke-WebRequest http://localhost/api/health/ready).Content
~~~

重新执行：

1. 原账号登录；
2. 打开原 Galaxy；
3. 打开 Step 5 创建的分享链接。

Expected: ready；用户、Galaxy 和 SharedBook 均保持可用。

- [ ] **Step 9: 检查安全边界**

Run:

~~~powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker exec app id
docker compose --env-file .env.docker exec app sh -c "test ! -f /app/.env.docker && test ! -f /app/.env.local"
~~~

Expected:

- 只有 nginx 发布 0.0.0.0:80；
- postgres 与 app 没有宿主机公开端口；
- id 显示 uid=1001；
- App 容器不含私有环境文件。

- [ ] **Step 10: 确认验收没有产生待提交文件**

Run:

~~~powershell
git status --short
git diff --check
~~~

Expected: worktree 干净；.env.docker、backups、数据库 volume 和构建产物均未进入 Git。

---

## 完成定义

- Docker Compose 从空 volume 完成 migration 并启动完整栈。
- Nginx 是唯一公开端口。
- App 使用非 root 用户和 standalone 产物。
- PostgreSQL 数据在容器重建后保留。
- 备份和恢复完成真实演练。
- Resend 登录、Galaxy、发布和跨浏览器分享通过。
- OpenAI Key 为空时 Mock 演示仍可用。
- test、lint、build、docker compose config 全部通过。
- README 不再把云服务器或云 RDS 描述为当前部署方式。
