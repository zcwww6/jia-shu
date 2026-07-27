export const LEGACY_AI_ENDPOINT_DISABLED_RESPONSE = {
  code: "AI_LEGACY_ENDPOINT_DISABLED",
  message: "旧 AI 提取端点已停用，请通过受保护的记忆 AI 作业接口发起处理。",
  migrationEndpoint: "/api/memories/:memoryId/ai-jobs",
} as const;

export const LEGACY_AI_FEATURE_DISABLED_RESPONSE = {
  code: "AI_LEGACY_ENDPOINT_DISABLED",
  message: "旧 AI 功能端点已停用，当前暂无可用的受保护迁移入口。",
} as const;

export const LEGACY_DEMO_ENTRY_DISABLED_MESSAGE = "真实流程正在迁移，当前演示入口已停用。";
