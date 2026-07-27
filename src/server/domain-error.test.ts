import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error";

describe("DomainError", () => {
  it("preserves the machine-readable code, HTTP status, and safe default message", () => {
    const error = new DomainError("VERSION_CONFLICT", 409);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DomainError");
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.status).toBe(409);
    expect(error.message).toBe("请求无法完成，请检查后重试。");
  });

  it("allows a caller to provide a safe domain-specific message", () => {
    const error = new DomainError("NOT_FOUND", 404, "资源不存在或无权访问。");

    expect(error.message).toBe("资源不存在或无权访问。");
  });
});
