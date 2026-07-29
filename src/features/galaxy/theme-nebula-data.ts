export type ThemeNebulaKey = "亲子成长" | "父母人生" | "纪念星册" | "旅行星云";

export type ThemeNebulaSourceRange = "single_planet" | "family_galaxy" | "memorial";

export type ThemeNebula = {
  key: ThemeNebulaKey;
  title: string;
  promise: string;
  sourceHints: readonly [string, string, string];
  intelligentNote: string;
  sourceRange: ThemeNebulaSourceRange;
  tone: "child" | "parent" | "memorial" | "travel";
};

export const themeNebulae: readonly ThemeNebula[] = [
  {
    key: "亲子成长",
    title: "亲子成长星云",
    promise: "把每一次长大，留成未来也能认出的光。",
    sourceHints: ["第一次与里程碑", "成长照片", "写给未来的话"],
    intelligentNote: "智能编排会先寻找时间线，再把家人的不同视角并排放进书里。",
    sourceRange: "single_planet",
    tone: "child",
  },
  {
    key: "父母人生",
    title: "父母人生星云",
    promise: "年轻时的 TA、成家、工作、没说出口的话。",
    sourceHints: ["一次认真采访", "旧日记与书信", "工作和成家的照片"],
    intelligentNote: "智能编排会标出人生章节之间的停顿，让家人决定哪些话该被留下。",
    sourceRange: "family_galaxy",
    tone: "parent",
  },
  {
    key: "纪念星册",
    title: "纪念星云",
    promise: "让离开的人，继续在家人的故事里发光。",
    sourceHints: ["手稿与拿手菜谱", "熟悉的声音", "写给 TA 的寄语"],
    intelligentNote: "智能编排会把零散的想念归成温柔线索，不替家人替 TA 下结论。",
    sourceRange: "memorial",
    tone: "memorial",
  },
  {
    key: "旅行星云",
    title: "旅行星云",
    promise: "让同一段远行，在每个人的记忆里重新相遇。",
    sourceHints: ["路线与票据", "沿途照片", "旅行日记和语音"],
    intelligentNote: "智能编排会先串起路途，再保留每个人看见的不同风景。",
    sourceRange: "family_galaxy",
    tone: "travel",
  },
] as const;

export function getThemeNebula(key: ThemeNebulaKey): ThemeNebula {
  const theme = themeNebulae.find((candidate) => candidate.key === key);

  if (!theme) {
    throw new Error(`未找到主题星云：${key}`);
  }

  return theme;
}
