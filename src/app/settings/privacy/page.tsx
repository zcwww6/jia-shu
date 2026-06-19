import { StagePage } from "@/features/stage/stage-page";

export default function PrivacyPage() {
  return (
    <StagePage
      eyebrow="隐私星域"
      title="分享前确认范围"
      description="公开的是已选择的一页家书，不是整颗星球。后续将细分正文、来源标题和原始全文的可见开关。"
      primaryAction={{ href: "/galaxy", label: "返回我的星系" }}
    />
  );
}
