# 家书星球

AI 驱动的家庭记忆星系工作台。用户、星系和分享数据通过 Prisma 持久化到 PostgreSQL；Mock 仅作为 AI 能力和演示体验的回退。

## 当前主线

- 当前主对照 demo：`前端原型/jiashu_planet_galaxy_v7_3_planet_roaming_fixed.html`
- 当前核心文档：
  - `产品设计文档/设计文档-第一版.md`
  - `产品设计文档/前端设计文档1.md`
  - `产品开发文档/开发方案.md`
- 历史原型、阶段性进展材料和杂项附件已归档到 `历史资料/`

## 分支模型

- `master`：最终发版分支，只合入测试稳定版本。
- `develop`：日常集成开发分支。
- `test`：测试验收分支。
- `feature/*`：临时功能开发分支，从 `develop` 切出，完成后合回 `develop`。

当前工程化首阶段分支：`feature/bootstrap-next-app`。

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 风格基础组件
- Framer Motion
- Vitest + Testing Library
- PostgreSQL + Prisma 持久化；OpenAI 能力按需启用

## 本地开发

项目默认通过 Docker Compose 在一台本地电脑上运行 PostgreSQL、数据库迁移、Next.js 应用和 Nginx，不需要云服务器或 RDS。

### 运行要求

- Windows 上安装 Docker Desktop 并切换到 Linux containers；其他系统可安装 Docker Engine。
- 安装 Docker Compose v2（使用 `docker compose` 命令）。
- 电脑能访问 Resend API，并准备一个已验证、可发信的 Resend API Key 和发件人地址，否则邮件登录无法使用。
- OpenAI API 仅在启用真实 AI 能力时需要；不用时可将 `OPENAI_API_KEY` 留空。

先在 PowerShell 中确认 Docker Engine 和 Compose 可用：

```powershell
docker info
docker compose version
```

### 首次配置

复制 Docker 环境变量模板；`.env.docker` 包含密钥，不要提交到 Git：

```powershell
Copy-Item .env.docker.example .env.docker
```

使用 Windows PowerShell 自带的 .NET 加密随机数生成器，生成仅含小写十六进制字符、可安全放入数据库 URL 的密码：

```powershell
$dbPasswordBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($dbPasswordBytes)
$dbPassword = ([System.BitConverter]::ToString($dbPasswordBytes)).Replace('-', '').ToLowerInvariant()
$dbPassword
$rng.Dispose()
```

命令输出的 `$dbPassword` 同时填入 `.env.docker` 的 `POSTGRES_PASSWORD`，以及 `DATABASE_URL` 中密码所在的位置。两处必须完全相同，且容器内数据库主机名必须保持为 `postgres`，例如结构应为 `postgresql://jiashu:<同一个密码>@postgres:5432/jiashu`。不要使用示例密码，也不要把真实密码粘贴到命令或文档中。

再生成 Auth.js 密钥：

```powershell
$authSecretBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($authSecretBytes)
$authSecret = [System.Convert]::ToBase64String($authSecretBytes)
$authSecret
$rng.Dispose()
```

命令输出的 `$authSecret` 填入 `AUTH_SECRET`。同时把 `AUTH_RESEND_API_KEY` 改成可用的 Resend API Key，把 `AUTH_RESEND_FROM` 改成 Resend 已验证域名下的发件人；保留 `AUTH_URL=http://localhost`。如需真实 AI，再填写 `OPENAI_API_KEY`，并按服务商配置 `OPENAI_MODEL` 和 `OPENAI_BASE_URL`。

### 首次启动与检查

构建镜像并在后台启动全部服务：

```powershell
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs migrate
```

`migrate` 日志应显示迁移成功，`postgres`、`app` 和 `nginx` 应为运行或健康状态。随后访问 <http://localhost>。

### 日常启停

```powershell
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker down
```

`stop` 保留容器，`down` 删除容器和网络但保留命名卷。**严禁把 `docker compose down -v` 当作日常命令：`-v` 会删除 PostgreSQL 数据卷并造成数据丢失。** 只有确认已有可恢复备份、并明确要销毁本地数据时才可使用它。

### 升级

升级前先按下一节备份，然后依次拉取基础镜像、重建、迁移和启动：

```powershell
docker compose --env-file .env.docker build --pull
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker ps
```

如果构建、迁移或健康检查失败，先查看对应服务日志，不要删除数据卷。

### 数据库备份

仓库的 `backups` 目录挂载为数据库容器内的 `/backups`。以下命令以 PostgreSQL custom format 直接生成手工备份：

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
docker compose --env-file .env.docker exec -T postgres pg_dump -U jiashu -d jiashu -Fc -f /backups/jiashu-manual.dump
Get-Item .\backups\jiashu-manual.dump
```

命名卷 `postgres_data` 本身不是备份；磁盘损坏会同时影响卷和本机备份。定期把 `.\backups\jiashu-manual.dump` 复制到另一块磁盘或 NAS，并按日期保留多个版本。

### 数据库恢复

恢复会覆盖当前数据库内容。先确认备份文件存在并停止会访问数据库的 `app` 和 `nginx`，再恢复、补跑迁移，最后启动应用：

```powershell
Get-Item .\backups\jiashu-manual.dump
docker compose --env-file .env.docker stop app nginx
docker compose --env-file .env.docker exec -T postgres pg_restore -U jiashu -d jiashu --clean --if-exists --no-owner /backups/jiashu-manual.dump
docker compose --env-file .env.docker run --rm migrate
docker compose --env-file .env.docker up -d app nginx
docker compose --env-file .env.docker ps
```

恢复后检查 <http://localhost/api/health/ready>，并实际验证邮件登录、进入星系、发布家书和打开分享链接。若恢复失败，保持应用停止，先排查 `pg_restore` 输出，不要继续写入数据库。

### 源码开发

需要热更新时，可只启动 Docker 中的数据库，并从宿主机运行 Next.js：

```powershell
$dockerEnv = ConvertFrom-StringData (Get-Content .env.docker -Raw)
$hostDatabaseUrl = $dockerEnv.DATABASE_URL.Replace('@postgres:5432', '@127.0.0.1:5432')

function ConvertTo-DotEnvValue {
  param([AllowNull()][AllowEmptyString()][string]$Value)
  if ($null -eq $Value) { $Value = '' }
  if ($Value.Length -ge 2 -and $Value.StartsWith('"') -and $Value.EndsWith('"')) {
    $Value = $Value.Substring(1, $Value.Length - 2)
  }
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
  return '"' + $escaped + '"'
}

$localEnv = @(
  "DATABASE_URL=$(ConvertTo-DotEnvValue $hostDatabaseUrl)"
  "AUTH_SECRET=$(ConvertTo-DotEnvValue $dockerEnv.AUTH_SECRET)"
  'AUTH_URL="http://localhost:3000"'
  'AUTH_TRUST_HOST="true"'
  "AUTH_RESEND_API_KEY=$(ConvertTo-DotEnvValue $dockerEnv.AUTH_RESEND_API_KEY)"
  "AUTH_RESEND_FROM=$(ConvertTo-DotEnvValue $dockerEnv.AUTH_RESEND_FROM)"
  "OPENAI_API_KEY=$(ConvertTo-DotEnvValue $dockerEnv.OPENAI_API_KEY)"
  "OPENAI_MODEL=$(ConvertTo-DotEnvValue $dockerEnv.OPENAI_MODEL)"
  "OPENAI_BASE_URL=$(ConvertTo-DotEnvValue $dockerEnv.OPENAI_BASE_URL)"
)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines((Join-Path (Get-Location) '.env.local'), $localEnv, $utf8NoBom)

docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml up -d postgres
npx pnpm install
npx pnpm prisma generate
npx pnpm prisma migrate deploy
npx pnpm dev
```

上述命令从已配置的 `.env.docker` 生成 `.env.local`，只把数据库容器主机名替换成本机回环地址，并复制认证、Resend 和可选 OpenAI 配置；引号转义会保留 `AUTH_RESEND_FROM` 的显示名，空的可选值也会正常写入。启动开发服务器前会执行生产式迁移，因此全新数据库也会获得完整 schema。`.env.local` 包含密钥，不要提交到 Git。`compose.dev.yaml` 仅为开发数据库开放 `127.0.0.1:5432`，不要把它改成公网监听。

### 提交前验证

```powershell
npx pnpm prisma generate
npx pnpm test
npx pnpm lint
npx pnpm build
docker compose --env-file .env.docker config --quiet
```

如果本机已通过 Corepack 正常启用 `pnpm`，也可以直接使用对应的 `pnpm` 命令。

## 目录结构

- `src/app`：App Router 页面壳。
- `src/features/galaxy`：我的星系工作台。
- `src/features/planet`：星球内部漫游。
- `src/features/stage`：阶段一通用占位页。
- `src/shared/mock`：Mock 数据。
- `src/shared/types`：跨模块类型定义。
- `src/shared/ui`：可复用 UI 基础组件。
