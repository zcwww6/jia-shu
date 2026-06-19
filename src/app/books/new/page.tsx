import { StagePage } from "@/features/stage/stage-page";

export default function NewBookPage() {
  return (
    <StagePage
      eyebrow="家书工坊"
      title="写成一页家书"
      description="第一阶段使用 Mock 草稿展示来源范围、主题语气和 sourceMemoryIds。分享前确认会在后续 P0 中接入。"
      primaryAction={{ href: "/settings/privacy", label: "查看分享前确认" }}
    />
  );
}
