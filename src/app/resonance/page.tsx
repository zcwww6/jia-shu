import { StagePage } from "@/features/stage/stage-page";

export default function ResonancePage() {
  return (
    <StagePage
      eyebrow="共鸣星轨"
      title="2018 除夕共鸣星轨"
      description="这里展示两颗星球之间的共同记忆候选、来源对比、匹配分数和带入家书工坊的入口。"
      primaryAction={{ href: "/books/new", label: "带入家书工坊" }}
    />
  );
}
