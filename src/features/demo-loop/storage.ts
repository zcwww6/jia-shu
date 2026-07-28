"use client";

import type {
  MemoryExtractResponse,
  MemoryStar,
  ResonanceScanResponse,
} from "@/shared/types/galaxy";

const extractKey = "jiashu-demo-extract";
const resonanceKey = "jiashu-demo-resonance";

// 星系内闭环专用 key，与独立路由页（demo-loop）的 key 区分，避免互相覆盖。
const galaxyExtractKey = "jiashu-galaxy-extract";
const galaxyLitMemoriesKey = "jiashu-galaxy-lit-memories";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
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

// ---- 星系内闭环（galaxy-workspace）专用存取 ----

export function readGalaxyExtractResult() {
  return readJson<MemoryExtractResponse>(galaxyExtractKey);
}

export function writeGalaxyExtractResult(value: MemoryExtractResponse) {
  writeJson(galaxyExtractKey, value);
}

export function readLitMemories() {
  const memories = readJson<MemoryStar[]>(galaxyLitMemoriesKey);
  return Array.isArray(memories) ? memories : [];
}

export function writeLitMemories(value: MemoryStar[]) {
  writeJson(galaxyLitMemoriesKey, value);
}

export function appendLitMemory(value: MemoryStar) {
  const current = readLitMemories();
  const next = [...current.filter((memory) => memory.id !== value.id), value];
  writeLitMemories(next);
  return next;
}
