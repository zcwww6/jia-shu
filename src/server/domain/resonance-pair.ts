export type ResonancePair = {
  sourceMemoryId: string;
  targetMemoryId: string;
};

export function normalizeResonancePair(firstMemoryId: string, secondMemoryId: string): ResonancePair {
  return firstMemoryId.localeCompare(secondMemoryId) <= 0
    ? { sourceMemoryId: firstMemoryId, targetMemoryId: secondMemoryId }
    : { sourceMemoryId: secondMemoryId, targetMemoryId: firstMemoryId };
}
