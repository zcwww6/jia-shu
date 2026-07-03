import { describe, expect, it, vi } from "vitest";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("@/auth", () => ({
  signIn,
}));

import { requestMagicLink } from "./actions";

describe("requestMagicLink", () => {
  it("rejects empty email input", async () => {
    await expect(requestMagicLink("")).rejects.toThrow("请输入邮箱");
  });

  it("normalizes email and calls Auth.js signIn", async () => {
    await requestMagicLink("  user@example.com  ");

    expect(signIn).toHaveBeenCalledWith("resend", {
      email: "user@example.com",
      redirectTo: "/galaxy",
    });
  });
});
