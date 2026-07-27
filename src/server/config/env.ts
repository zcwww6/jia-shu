type EnvSource = Record<string, string | undefined>;

function required(source: EnvSource, key: keyof EnvSource) {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`Missing env: ${String(key)}`);
  }
  return value;
}

function requiredBoolean(source: EnvSource, key: keyof EnvSource) {
  required(source, key);
  const value = source[key];
  if (value !== "true" && value !== "false") {
    throw new Error(`Invalid boolean env: ${String(key)}`);
  }
  return value === "true";
}

function optionalBoolean(source: EnvSource, key: keyof EnvSource) {
  const value = source[key];
  if (value === undefined) {
    return false;
  }
  if (value !== "true" && value !== "false") {
    throw new Error(`Invalid boolean env: ${String(key)}`);
  }
  return value === "true";
}

export function loadAppEnv(source: EnvSource = process.env) {
  const OPENAI_MODEL = source.OPENAI_MODEL?.trim() || null;

  return {
    DATABASE_URL: required(source, "DATABASE_URL"),
    AUTH_SECRET: required(source, "AUTH_SECRET"),
    AUTH_URL: required(source, "AUTH_URL"),
    AUTH_TRUST_HOST: requiredBoolean(source, "AUTH_TRUST_HOST"),
    AUTH_RESEND_API_KEY: required(source, "AUTH_RESEND_API_KEY"),
    AUTH_RESEND_FROM: required(source, "AUTH_RESEND_FROM"),
    AUTH_SESSION_COOKIE_NAME: source.AUTH_SESSION_COOKIE_NAME?.trim() || null,
    OPENAI_API_KEY: source.OPENAI_API_KEY?.trim() || null,
    OPENAI_MODEL,
    OPENAI_BASE_URL: source.OPENAI_BASE_URL?.trim() || null,
    MEDIA_STORAGE_ROOT: source.MEDIA_STORAGE_ROOT?.trim() || "/data/media",
    OPENAI_VISION_MODEL: source.OPENAI_VISION_MODEL?.trim() || null,
    OPENAI_TRANSCRIPTION_MODEL: source.OPENAI_TRANSCRIPTION_MODEL?.trim() || null,
    OPENAI_EMBEDDING_MODEL: source.OPENAI_EMBEDDING_MODEL?.trim() || null,
    DEMO_MODE: optionalBoolean(source, "DEMO_MODE"),
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
  get AUTH_URL() {
    return required(process.env, "AUTH_URL");
  },
  get AUTH_TRUST_HOST() {
    return requiredBoolean(process.env, "AUTH_TRUST_HOST");
  },
  get AUTH_RESEND_API_KEY() {
    return required(process.env, "AUTH_RESEND_API_KEY");
  },
  get AUTH_RESEND_FROM() {
    return required(process.env, "AUTH_RESEND_FROM");
  },
  get AUTH_SESSION_COOKIE_NAME() {
    return process.env.AUTH_SESSION_COOKIE_NAME?.trim() || null;
  },
  get OPENAI_API_KEY() {
    return process.env.OPENAI_API_KEY?.trim() || null;
  },
  get OPENAI_MODEL() {
    return process.env.OPENAI_MODEL?.trim() || null;
  },
  get OPENAI_BASE_URL() {
    return process.env.OPENAI_BASE_URL?.trim() || null;
  },
  get MEDIA_STORAGE_ROOT() {
    return process.env.MEDIA_STORAGE_ROOT?.trim() || "/data/media";
  },
  get OPENAI_VISION_MODEL() {
    return process.env.OPENAI_VISION_MODEL?.trim() || null;
  },
  get OPENAI_TRANSCRIPTION_MODEL() {
    return process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || null;
  },
  get OPENAI_EMBEDDING_MODEL() {
    return process.env.OPENAI_EMBEDDING_MODEL?.trim() || null;
  },
  get DEMO_MODE() {
    return optionalBoolean(process.env, "DEMO_MODE");
  },
};
