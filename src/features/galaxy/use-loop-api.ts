"use client";

import { useState } from "react";

import type {
  BookGenerateRequest,
  BookGenerateResponse,
} from "@/shared/types/galaxy";

async function postJson<T>(url: string, body: unknown, errorMessage: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export function generateBook(request: BookGenerateRequest): Promise<BookGenerateResponse> {
  return postJson<BookGenerateResponse>("/api/books/generate", request, "家书生成失败，请稍后重试");
}

export function publishBook(input: {
  draft: BookGenerateResponse["draft"];
  body: string;
  sections: BookGenerateResponse["sections"];
  share: { showBody: boolean; showSourceTitles: boolean; showOriginalText: boolean };
}): Promise<{ token: string; url: string }> {
  return postJson<{ token: string; url: string }>("/api/books/publish", input, "家书发布失败，请稍后重试");
}

/**
 * 星系内闭环的轻量异步调用封装：统一 loading / error，
 * 供 SidePanel 等组件内联调用 /api/* 路由。
 */
export function useLoopApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    setLoading(true);
    setError(null);
    try {
      return await task();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "请求失败，请稍后重试");
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, run, setError };
}
