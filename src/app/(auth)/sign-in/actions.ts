"use server";

import { signIn } from "@/auth";

export async function requestMagicLink(email: string) {
  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    throw new Error("请输入邮箱");
  }

  await signIn("resend", {
    email: normalizedEmail,
    redirectTo: "/galaxy",
  });
}

export async function submitMagicLink(formData: FormData) {
  await requestMagicLink(String(formData.get("email") ?? ""));
}
