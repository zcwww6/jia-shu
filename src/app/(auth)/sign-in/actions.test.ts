import { beforeEach, describe, expect, it, vi } from "vitest";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("@/auth", () => ({
  signIn,
}));

import { requestMagicLink, submitMagicLink } from "./actions";

describe("requestMagicLink", () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it("rejects empty email input", async () => {
    await expect(requestMagicLink("")).rejects.toThrow("请输入邮箱");
  });

  it("rejects malformed email input", async () => {
    await expect(requestMagicLink("not-an-email")).rejects.toThrow("请输入有效的邮箱");
  });

  it("normalizes email and calls Auth.js signIn", async () => {
    await requestMagicLink("  User@Example.com  ");

    expect(signIn).toHaveBeenCalledWith("resend", {
      email: "user@example.com",
      redirectTo: "/galaxy",
    });
  });
});

describe("submitMagicLink", () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it("rejects non-string FormData values", async () => {
    const formData = new FormData();
    formData.set("email", new File(["hello"], "avatar.txt", { type: "text/plain" }));

    await expect(submitMagicLink(formData)).rejects.toThrow("请输入有效的邮箱");
  });
});
