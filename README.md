# 家书星球

AI 驱动的家庭记忆星系工作台。当前阶段先完成可维护的 Next.js 工程基线，使用 Mock 数据跑通 v7.3 的“我的星系 / 星球内部漫游 / 共鸣星轨 / 家书工坊”体验壳。

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
- Mock 数据优先，暂不接真实数据库和 AI

## 本地开发

```bash
npx pnpm install
npx pnpm dev
```

### Authenticated Baseline Setup

```bash
cp .env.example .env.local
```

填入 `.env.local` 中的 `DATABASE_URL`、`AUTH_SECRET`、`AUTH_RESEND_API_KEY`、`AUTH_RESEND_FROM`，然后执行：

```bash
npx pnpm prisma generate
npx pnpm prisma migrate dev
```

常用验证：

```bash
npx pnpm test
npx pnpm lint
npx pnpm build
```

如果本机已通过 Corepack 正常启用 `pnpm`，也可以直接使用 `pnpm install`、`pnpm dev`。

## 目录结构

- `src/app`：App Router 页面壳。
- `src/features/galaxy`：我的星系工作台。
- `src/features/planet`：星球内部漫游。
- `src/features/stage`：阶段一通用占位页。
- `src/shared/mock`：Mock 数据。
- `src/shared/types`：跨模块类型定义。
- `src/shared/ui`：可复用 UI 基础组件。
