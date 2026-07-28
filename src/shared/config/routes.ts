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
    href: "/galaxy",
    description: "在家庭星系中选择家人星球并开始漫游。",
  },
  {
    label: "点亮记忆星",
    href: "/galaxy",
    description: "在家人星球上记录文字、图片、语音或日记。",
  },
  {
    label: "共鸣星轨",
    href: "/galaxy",
    description: "在家庭星系中查看并确认共鸣候选。",
  },
  {
    label: "主题星云",
    href: "/galaxy",
    description: "在星球工坊选择主题，并在家书生成时带入。",
  },
  {
    label: "家书工坊",
    href: "/galaxy",
    description: "在家庭星系中从已确认的共鸣星轨创建家书。",
  },
];
