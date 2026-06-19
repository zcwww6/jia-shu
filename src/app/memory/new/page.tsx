import { StagePage } from "@/features/stage/stage-page";

export default function NewMemoryPage() {
  return (
    <StagePage
      eyebrow="记忆星群"
      title="点亮记忆星"
      description="第一阶段先提供 Mock 入口。后续这里会承载文字、图片、语音转写和 AI 结构化确认流程。"
      primaryAction={{ href: "/resonance", label: "查看共鸣星轨" }}
    />
  );
}
