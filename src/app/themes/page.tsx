import { StagePage } from "@/features/stage/stage-page";

export default function ThemesPage() {
  return (
    <StagePage
      eyebrow="主题星云"
      title="选择家书主题"
      description="第一阶段以模板选择占位，保留家庭团圆、父母人生、亲子成长、纪念星册、旅行星云和伴侣星云。"
      primaryAction={{ href: "/books/new", label: "进入家书工坊" }}
    />
  );
}
