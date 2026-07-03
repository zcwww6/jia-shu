"use server";

import { signIn } from "@/auth";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestMagicLink(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("请输入邮箱");
  }

  if (!emailPattern.test(normalizedEmail)) {
    throw new Error("请输入有效的邮箱");
  }

  await signIn("resend", {
    email: normalizedEmail,
    redirectTo: "/galaxy",
  });
}

export async function submitMagicLink(formData: FormData) {
  const email = formData.get("email");

  if (typeof email !== "string") {
    throw new Error("请输入有效的邮箱");
  }

  await requestMagicLink(email);
}
