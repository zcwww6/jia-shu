import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/auth", () => ({
  auth,
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

import SignInPage from "./page";

describe("SignInPage", () => {
  it("renders the sign-in form for unauthenticated visitors", async () => {
    auth.mockResolvedValue(null);

    render(await SignInPage());

    expect(screen.getByRole("heading", { name: "邮箱登录" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "邮箱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送魔法链接" })).toBeInTheDocument();
  });

  it("redirects authenticated visitors to /galaxy", async () => {
    auth.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com" },
    });

    await expect(SignInPage()).rejects.toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
  });
});
