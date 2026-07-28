import type { CSSProperties } from "react";

export type PlanetThemeOption = {
  description: string;
  label: string;
  palette: [string, string, string];
  tone: string;
};

export const planetThemeOptions: PlanetThemeOption[] = [
  {
    label: "家书暖夜",
    description: "灯火、团圆与慢慢靠近的家人",
    palette: ["#e7b26d", "#9e5a4d", "#251d2c"],
    tone: "暖金与烟紫",
  },
  {
    label: "极光蓝绿",
    description: "旅行、成长与向外展开的好奇",
    palette: ["#a4ead8", "#39899e", "#152b4b"],
    tone: "海雾与极光",
  },
  {
    label: "橘粉黄昏",
    description: "相遇、陪伴与被认真记住的日常",
    palette: ["#ffbe91", "#d97182", "#46233f"],
    tone: "晚霞与蔷薇",
  },
  {
    label: "深空墨蓝",
    description: "纪念、私语与不张扬的长久守望",
    palette: ["#a8b8db", "#515a93", "#11182d"],
    tone: "月白与深海",
  },
];

const legacyThemeAliases: Record<string, string> = {
  "极光家书": "极光蓝绿",
  "金色里程碑": "家书暖夜",
  "暖夜": "家书暖夜",
  "暖夜星环": "家书暖夜",
  "暖橘": "家书暖夜",
  "暖橘星环": "家书暖夜",
  "山风星册": "极光蓝绿",
  "新生星环": "极光蓝绿",
  "柔紫纪念光": "深空墨蓝",
};

export function resolvePlanetTheme(theme: string | null | undefined): PlanetThemeOption {
  const canonicalLabel = theme ? legacyThemeAliases[theme] ?? theme : "家书暖夜";

  return planetThemeOptions.find((option) => option.label === canonicalLabel) ?? planetThemeOptions[0];
}

export function planetThemeStyle(theme: string | null | undefined): CSSProperties {
  const [a, b, c] = resolvePlanetTheme(theme).palette;

  return {
    "--a": a,
    "--b": b,
    "--c": c,
    "--glow": a,
    "--planet-a": a,
    "--planet-b": b,
    "--planet-c": c,
    "--planet-glow": a,
  } as CSSProperties;
}
