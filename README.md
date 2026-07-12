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
- 如需从源码开发，安装 Node.js 22 和 Corepack；后续 `corepack pnpm` 会使用仓库 `packageManager` 固定的 pnpm 11.8.0。

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

### 已有数据库采用 baseline

本节只适用于这样的既有数据库或命名卷：数据库中已经存在当前 schema 对象，但 `_prisma_migrations` 尚未记录 `20260712000000_auth_persistence_baseline`。全新命名卷不执行本节，直接按“首次启动与检查”让正常迁移链初始化数据库。

开始前停止所有写入者：在运行 `corepack pnpm dev` 的宿主机 PowerShell 中按 `Ctrl+C`，关闭 Prisma Studio、数据库 GUI、`psql` 和其他客户端，并停止 app、nginx 和 migrate 容器。只启动 PostgreSQL，不要启动完整的 app/migrate 依赖链：

```powershell
docker compose --env-file .env.docker stop app nginx migrate
if ($LASTEXITCODE -ne 0) { throw '停止 app/nginx/migrate 失败；不要继续采用 baseline。' }
docker compose --env-file .env.docker up -d postgres
if ($LASTEXITCODE -ne 0) { throw '仅启动 PostgreSQL 失败；不要继续采用 baseline。' }
```

接着必须先完整执行并验证下文“数据库备份”的加固流程，确认 custom format 临时归档已通过目录校验和完整解压读取、已提升为正式时间戳文件，并已生成符合要求的异地加密副本。备份未完成或未通过任一校验时，不得继续。

保持所有写入者停止，在同一个 PowerShell 中解析 `.env.docker` 并验证容器数据库地址。不要输出 `$databaseUrl`；后续 `docker compose run` 会像现有 Compose 流程一样把同一个 `DATABASE_URL` 注入 `migrate` 容器：

```powershell
$dockerEnv = ConvertFrom-StringData (Get-Content .env.docker -Raw)
$databaseUrl = $dockerEnv.DATABASE_URL
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw '.env.docker 中的 DATABASE_URL 不能为空。' }
if ($databaseUrl -notmatch '@postgres(?::5432)?/') { throw 'DATABASE_URL 必须使用容器主机名 postgres；不要继续采用 baseline。' }

docker compose --env-file .env.docker run --rm migrate pnpm prisma migrate status
$statusExitCode = $LASTEXITCODE
if ($statusExitCode -ne 0 -and $statusExitCode -ne 1) { throw "读取迁移状态失败，退出码：$statusExitCode" }
```

人工核对状态输出：本流程只允许 baseline 尚未应用，不能存在失败迁移、迁移历史分叉或其他意外状态。然后执行精确 drift gate，并立即捕获退出码：

```powershell
docker compose --env-file .env.docker run --rm migrate pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
$driftExitCode = $LASTEXITCODE
if ($driftExitCode -eq 2) { throw '检测到 schema drift；禁止 resolve 或 deploy。请先在数据库副本上生成并评审纠正迁移。' }
if ($driftExitCode -ne 0) { throw "schema drift 检查执行失败，退出码：$driftExitCode" }
```

退出码 `0` 才表示现有数据库与 `prisma/schema.prisma` 精确匹配。退出码 `2` 表示存在 drift，必须停止，不能执行 `resolve` 或 `deploy`；其他非零退出码表示检查错误。drift 必须先在数据库副本上单独生成、测试并评审纠正迁移，严禁对原数据库使用 `prisma db push`，也严禁在未确认精确匹配时盲目 `resolve`。

只有 drift gate 返回 `0`，才可依次记录 baseline、部署后续迁移并启动应用：

```powershell
docker compose --env-file .env.docker run --rm migrate pnpm prisma migrate resolve --applied 20260712000000_auth_persistence_baseline
if ($LASTEXITCODE -ne 0) { throw '记录 baseline 失败；app/nginx 保持停止。' }
docker compose --env-file .env.docker run --rm migrate pnpm prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw '部署后续迁移失败；app/nginx 保持停止。' }
docker compose --env-file .env.docker up -d app nginx
if ($LASTEXITCODE -ne 0) { throw 'app/nginx 启动失败，请检查服务日志。' }
```

`migrate resolve --applied` 只在 Prisma 迁移历史中记录 baseline 已应用，不会执行该 migration 的 SQL；因此前面的精确 drift gate 和已验证备份不可省略。

### 升级

升级前先按下一节生成并验证新备份。备份成功后构建镜像；只有构建成功才停止应用并执行迁移，迁移成功后才启动新版本。执行下列离线升级命令前，还必须在宿主机运行 `corepack pnpm dev` 的 PowerShell 中按 `Ctrl+C`，并关闭 Prisma Studio、数据库 GUI、`psql` 等数据库客户端；在 `docker compose ... up -d` 成功前不要重新启动这些宿主机进程：

```powershell
docker compose --env-file .env.docker build --pull
if ($LASTEXITCODE -ne 0) { throw '镜像构建失败；当前应用保持原状。' }
docker compose --env-file .env.docker stop app nginx
if ($LASTEXITCODE -ne 0) { throw '停止 app/nginx 失败；不要继续迁移。' }
docker compose --env-file .env.docker run --rm migrate
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败；app/nginx 保持停止，请先排查。' }
docker compose --env-file .env.docker up -d
if ($LASTEXITCODE -ne 0) { throw '新版本启动失败，请检查服务日志。' }
docker compose --env-file .env.docker ps
if ($LASTEXITCODE -ne 0) { throw '读取服务状态失败。' }
```

如果构建、迁移或健康检查失败，先查看对应服务日志，不要删除数据卷。迁移失败时上述 `throw` 会阻止后续启动，避免应用在未知 schema 上继续写入。

镜像使用固定版本标签；升级时继续使用 `docker compose ... build --pull` 刷新当前固定标签对应的镜像层，但该命令不会把 Compose 或 Dockerfile 中的标签升级到更新的补丁版本。每月至少检查一次这些固定镜像标签的上游安全公告和 CVE；确认兼容并完成备份后，再明确更新固定标签、重新构建并执行本节验证，不要改用浮动的 `latest` 标签。

### 数据库备份

仓库的 `backups` 目录挂载为数据库容器内的 `/backups`。以下命令使用时间戳创建 PostgreSQL custom format 临时归档，验证归档可读取后才改为最终文件名，因此失败的导出不会覆盖上一次有效备份：

```powershell
$dockerEnv = ConvertFrom-StringData (Get-Content .env.docker -Raw)
$postgresUser = $dockerEnv.POSTGRES_USER
$postgresDb = $dockerEnv.POSTGRES_DB
if ([string]::IsNullOrWhiteSpace($postgresUser) -or [string]::IsNullOrWhiteSpace($postgresDb)) { throw '.env.docker 中的 POSTGRES_USER 和 POSTGRES_DB 不能为空。' }

New-Item -ItemType Directory -Force backups | Out-Null
$backupStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupName = "jiashu-$backupStamp.dump"
$tempBackupName = "$backupName.tmp"
$finalBackupPath = Join-Path .\backups $backupName
$tempContainerPath = "/backups/$tempBackupName"
$finalContainerPath = "/backups/$backupName"
if (Test-Path $finalBackupPath) { throw "备份文件已存在，拒绝覆盖：$finalBackupPath" }

docker compose --env-file .env.docker exec -T postgres pg_dump -U "$postgresUser" -d "$postgresDb" -Fc -f "$tempContainerPath"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump 失败；临时文件不会转为正式备份。' }
docker compose --env-file .env.docker exec -T postgres pg_restore --list "$tempContainerPath" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '备份归档校验失败；临时文件不会转为正式备份。' }
docker compose --env-file .env.docker exec -T postgres pg_restore --exit-on-error --file=/dev/null "$tempContainerPath" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '备份归档完整解压读取失败；临时文件不会转为正式备份。' }
docker compose --env-file .env.docker exec -T postgres mv "$tempContainerPath" "$finalContainerPath"
if ($LASTEXITCODE -ne 0) { throw '备份归档改名失败。' }
Get-Item $finalBackupPath
```

命名卷 `postgres_data` 本身不是备份；磁盘损坏会同时影响卷和本机备份。备份包含用户个人内容，以及会话和验证码令牌等认证数据，必须按敏感数据保护：异地副本只通过加密传输写入加密存储，使用受限 ACL 限制到必要管理员，并制定、执行和定期核查保留期限及安全删除策略。定期把时间戳命名的 `.\backups\jiashu-*.dump` 复制到符合这些要求的另一块磁盘或 NAS，并保留多个版本。失败留下的 `*.dump.tmp` 不是有效备份，可以在查明原因后删除。

### 数据库恢复

恢复会完全替换当前数据库。**开始前先按上一节为当前状态生成一份新的、已通过目录校验和完整解压读取的备份，并复制到另一块磁盘或 NAS。** 然后明确选择要恢复的时间戳文件；不要使用 `*.tmp`，也不要复用刚创建的当前状态备份文件名。

先在同一个 PowerShell 中运行以下归档检查。此阶段不会停止服务或修改数据库：

```powershell
$dockerEnv = ConvertFrom-StringData (Get-Content .env.docker -Raw)
$postgresUser = $dockerEnv.POSTGRES_USER
$postgresDb = $dockerEnv.POSTGRES_DB
if ([string]::IsNullOrWhiteSpace($postgresUser) -or [string]::IsNullOrWhiteSpace($postgresDb)) { throw '.env.docker 中的 POSTGRES_USER 和 POSTGRES_DB 不能为空。' }
$postgresDbSqlLiteral = $postgresDb.Replace("'", "''")

$backupName = 'jiashu-20260712-210000.dump'
$restorePath = Join-Path .\backups $backupName
if ($backupName -notmatch '^jiashu-\d{8}-\d{6}\.dump$' -or -not (Test-Path $restorePath)) { throw "恢复文件不存在或不是正式备份：$restorePath" }
Get-Item $restorePath
docker compose --env-file .env.docker exec -T postgres pg_restore --list "/backups/$backupName" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '所选恢复归档的目录校验失败；数据库未修改。' }
docker compose --env-file .env.docker exec -T postgres pg_restore --exit-on-error --file=/dev/null "/backups/$backupName" | Out-Null
if ($LASTEXITCODE -ne 0) { throw '所选恢复归档的完整解压读取失败；数据库未修改。' }
```

只有上述两项校验都成功后，才在运行 `corepack pnpm dev` 的宿主机 PowerShell 中按 `Ctrl+C` 停止开发服务器，并关闭 Prisma Studio、数据库 GUI、`psql` 等所有数据库客户端。保持使用同一个 PowerShell 执行下列恢复命令；在恢复和迁移全部成功前，不要重新启动这些宿主机写入者：

```powershell
docker compose --env-file .env.docker stop app nginx
if ($LASTEXITCODE -ne 0) { throw '停止 app/nginx 失败；不要继续恢复。' }
$activeConnectionText = docker compose --env-file .env.docker exec -T postgres psql -U "$postgresUser" -d template1 -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname = '$postgresDbSqlLiteral';"
if ($LASTEXITCODE -ne 0) { throw '检查数据库活动连接失败；app/nginx 保持停止。' }
[int]$activeConnectionCount = 0
if (-not [int]::TryParse(($activeConnectionText -join '').Trim(), [ref]$activeConnectionCount)) { throw '无法解析数据库活动连接数；app/nginx 保持停止。' }
if ($activeConnectionCount -gt 0) { throw "仍有 $activeConnectionCount 个客户端连接 $postgresDb；关闭所有宿主机写入者后重试。" }
docker compose --env-file .env.docker exec -T postgres dropdb -U "$postgresUser" --maintenance-db=template1 --if-exists --force "$postgresDb"
if ($LASTEXITCODE -ne 0) { throw '删除目标数据库失败；app/nginx 保持停止。' }
docker compose --env-file .env.docker exec -T postgres createdb -U "$postgresUser" --maintenance-db=template1 -O "$postgresUser" "$postgresDb"
if ($LASTEXITCODE -ne 0) { throw '重建空数据库失败；app/nginx 保持停止。' }
docker compose --env-file .env.docker exec -T postgres pg_restore -U "$postgresUser" -d "$postgresDb" --exit-on-error --single-transaction --no-owner "/backups/$backupName"
if ($LASTEXITCODE -ne 0) { throw 'pg_restore 失败；app/nginx 保持停止，请从已验证备份重新恢复。' }
docker compose --env-file .env.docker run --rm migrate
if ($LASTEXITCODE -ne 0) { throw '恢复后的数据库迁移失败；app/nginx 保持停止。' }
docker compose --env-file .env.docker up -d app nginx
if ($LASTEXITCODE -ne 0) { throw 'app/nginx 启动失败，请检查服务日志。' }
docker compose --env-file .env.docker ps
if ($LASTEXITCODE -ne 0) { throw '读取服务状态失败。' }
```

每个原生命令都在成功后才继续；任何 `throw` 都会阻止启动应用。恢复后检查 <http://localhost/api/health/ready>，并实际验证邮件登录、进入星系、发布家书和打开分享链接。若恢复失败，保持应用停止，先排查命令输出，不要继续写入数据库。恢复流程通过重建空库避免在部分已有对象上使用 `--clean`。

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

function Assert-NativeSuccess {
  param([string]$Action, [int]$ExitCode)
  if ($ExitCode -ne 0) { throw "$Action 失败（退出码 $ExitCode）。" }
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
Assert-NativeSuccess '启动开发数据库' $LASTEXITCODE
corepack pnpm install
Assert-NativeSuccess '安装依赖' $LASTEXITCODE
corepack pnpm prisma generate
Assert-NativeSuccess '生成 Prisma Client' $LASTEXITCODE
$env:DATABASE_URL = $hostDatabaseUrl
corepack pnpm prisma migrate deploy
Assert-NativeSuccess '执行数据库迁移' $LASTEXITCODE
corepack pnpm dev
```

上述命令从已配置的 `.env.docker` 生成 `.env.local`，只把数据库容器主机名替换成本机回环地址，并复制认证、Resend 和可选 OpenAI 配置；引号转义会保留 `AUTH_RESEND_FROM` 的显示名，空的可选值也会正常写入。Prisma 的 `dotenv/config` 不会自动加载 `.env.local`，所以迁移前还会将宿主机数据库地址显式导出为当前 PowerShell 的 `DATABASE_URL`。启动开发服务器前会执行生产式迁移，因此全新数据库也会获得完整 schema。`.env.local` 包含密钥，不要提交到 Git。`compose.dev.yaml` 仅为开发数据库开放 `127.0.0.1:5432`，不要把它改成公网监听。

### 提交前验证

```powershell
corepack pnpm prisma generate
corepack pnpm test
corepack pnpm lint
corepack pnpm build
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
