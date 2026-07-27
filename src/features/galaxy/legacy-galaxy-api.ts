export type LegacyPlanetInput = {
  name: string;
  type: "self" | "parent" | "child" | "partner" | "other";
  lifeState: "active" | "memorial";
  visibility: "private" | "family";
  role: string | null;
  theme?: string | null;
  summary?: string | null;
  position?: { x: number; y: number };
};

export type LegacyManagedPlanet = {
  id: string;
  name: string;
  type: LegacyPlanetInput["type"] | "memorial";
  lifeState: LegacyPlanetInput["lifeState"];
  visibility: "private" | "family" | "selected" | "public";
  role: string | null;
  theme: string | null;
  summary: string | null;
  position: { x: number | null; y: number | null };
  version: number;
  coverAssetId: string | null;
};

export type LegacyPlanetUpdate = {
  id: string;
  version: number;
  name?: string;
  type?: LegacyPlanetInput["type"];
  lifeState?: LegacyPlanetInput["lifeState"];
  visibility?: "private" | "family" | "selected" | "public";
  role?: string | null;
  theme?: string | null;
  summary?: string | null;
  position?: { x: number; y: number };
};

export type LegacyRelationshipInput = {
  sourcePlanetId: string;
  targetPlanetId: string;
  relationshipType: "self" | "parent" | "child" | "partner" | "ancestor" | "other";
  label: string | null;
  visibility: "private" | "family" | "selected";
};

export type LegacyRelationship = Omit<LegacyRelationshipInput, "sourcePlanetId"> & {
  id: string;
  sourcePlanetId: string;
};

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.message ?? "请求失败，请稍后重试。");
  }

  return body as T;
}

export function createLegacyPlanet(input: LegacyPlanetInput) {
  return requestJson<LegacyManagedPlanet>("/api/planets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(input),
  });
}

export function updateLegacyPlanet(input: LegacyPlanetUpdate) {
  const { id, version, ...changes } = input;

  return requestJson<LegacyManagedPlanet>(`/api/planets/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "If-Match-Version": String(version),
    },
    body: JSON.stringify({ version, ...changes }),
  });
}

export function archiveLegacyPlanet(planetId: string, version: number) {
  return requestJson<{ id: string; version: number; archived: boolean }>(`/api/planets/${planetId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      "If-Match-Version": String(version),
    },
    body: JSON.stringify({ version }),
  });
}

export function restoreLegacyPlanet(planetId: string, version: number) {
  return requestJson<{ id: string; version: number; archived: boolean }>(`/api/planets/${planetId}/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match-Version": String(version),
    },
    body: JSON.stringify({ version }),
  });
}

export function createLegacyRelationship(input: LegacyRelationshipInput) {
  const { sourcePlanetId, ...body } = input;

  return requestJson<LegacyRelationship>(`/api/planets/${sourcePlanetId}/relationships`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}
