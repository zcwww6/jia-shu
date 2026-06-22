"use client";

import type {
  BookGenerateResponse,
  MemoryExtractResponse,
  ResonanceScanResponse,
  ShareConfirmationPayload,
} from "@/shared/types/galaxy";

const extractKey = "jiashu-demo-extract";
const resonanceKey = "jiashu-demo-resonance";
const bookKey = "jiashu-demo-book";
const shareKey = "jiashu-demo-share";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

export function readExtractResult() {
  return readJson<MemoryExtractResponse>(extractKey);
}

export function writeExtractResult(value: MemoryExtractResponse) {
  writeJson(extractKey, value);
}

export function readResonanceResult() {
  return readJson<ResonanceScanResponse>(resonanceKey);
}

export function writeResonanceResult(value: ResonanceScanResponse) {
  writeJson(resonanceKey, value);
}

export function readBookResult() {
  return readJson<BookGenerateResponse>(bookKey);
}

export function writeBookResult(value: BookGenerateResponse) {
  writeJson(bookKey, value);
}

export function readSharePayload() {
  return readJson<ShareConfirmationPayload>(shareKey);
}

export function writeSharePayload(value: ShareConfirmationPayload) {
  writeJson(shareKey, value);
}
