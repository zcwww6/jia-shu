export interface AppRoute {
  label: string;
  href: string;
  description: string;
}

export const appRoutes: AppRoute[] = [
  {
    label: "我的星系",
    href: "/galaxy",
    description: "进入家庭星系主工作台。",
  },
  {
    label: "妈妈的星球",
    href: "/planet/mock-mom",
    description: "进入星球内部漫游。",
  },
  {
    label: "点亮记忆星",
    href: "/memory/new",
    description: "记录文字、图片或语音转写内容。",
  },
  {
    label: "共鸣星轨",
    href: "/resonance",
    description: "查看 AI 点亮的共同记忆候选。",
  },
  {
    label: "主题星云",
    href: "/themes",
    description: "选择家庭团圆、旅行或纪念主题。",
  },
  {
    label: "家书工坊",
    href: "/books/new",
    description: "生成一页有来源的家书。",
  },
];
