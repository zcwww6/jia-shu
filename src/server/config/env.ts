type EnvSource = Record<string, string | undefined>;

function required(source: EnvSource, key: keyof EnvSource) {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`Missing env: ${String(key)}`);
  }
  return value;
}

export function loadAppEnv(source: EnvSource = process.env) {
  return {
    DATABASE_URL: required(source, "DATABASE_URL"),
    AUTH_SECRET: required(source, "AUTH_SECRET"),
    AUTH_RESEND_API_KEY: required(source, "AUTH_RESEND_API_KEY"),
    AUTH_RESEND_FROM: required(source, "AUTH_RESEND_FROM"),
    OPENAI_API_KEY: source.OPENAI_API_KEY?.trim() || null,
    OPENAI_MODEL: source.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    OPENAI_BASE_URL: source.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
  };
}

type AppEnv = ReturnType<typeof loadAppEnv>;

export const env: AppEnv = {
  get DATABASE_URL() {
    return required(process.env, "DATABASE_URL");
  },
  get AUTH_SECRET() {
    return required(process.env, "AUTH_SECRET");
  },
  get AUTH_RESEND_API_KEY() {
    return required(process.env, "AUTH_RESEND_API_KEY");
  },
  get AUTH_RESEND_FROM() {
    return required(process.env, "AUTH_RESEND_FROM");
  },
  get OPENAI_API_KEY() {
    return process.env.OPENAI_API_KEY?.trim() || null;
  },
  get OPENAI_MODEL() {
    return process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  },
  get OPENAI_BASE_URL() {
    return process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  },
};
