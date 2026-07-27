import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

const { getPrismaClient } = vi.hoisted(() => ({ getPrismaClient: vi.fn() }));
const {
  archivePlanet,
  createPlanet,
  createPlanetRelationship,
  findActivePlanet,
  findActiveRelationship,
  findScopedPlanet,
  isPlanetUniqueConstraintError,
  lockActivePlanetsForRelationship,
  restorePlanet,
  updateActivePlanet,
} = vi.hoisted(() => ({
  archivePlanet: vi.fn(),
  createPlanet: vi.fn(),
  createPlanetRelationship: vi.fn(),
  findActivePlanet: vi.fn(),
  findActiveRelationship: vi.fn(),
  findScopedPlanet: vi.fn(),
  isPlanetUniqueConstraintError: vi.fn(),
  lockActivePlanetsForRelationship: vi.fn(),
  restorePlanet: vi.fn(),
  updateActivePlanet: vi.fn(),
}));
const { lockReadableCoverAsset } = vi.hoisted(() => ({ lockReadableCoverAsset: vi.fn() }));
const { executeIdempotentDbOperation } = vi.hoisted(() => ({ executeIdempotentDbOperation: vi.fn() }));

vi.mock("@/server/db/client", () => ({ getPrismaClient }));
vi.mock("@/server/db/planet-repo", () => ({
  archivePlanet,
  createPlanet,
  createPlanetRelationship,
  findActivePlanet,
  findActiveRelationship,
  findScopedPlanet,
  isPlanetUniqueConstraintError,
  lockActivePlanetsForRelationship,
  restorePlanet,
  updateActivePlanet,
}));
vi.mock("@/server/db/asset-repo", () => ({ lockReadableCoverAsset }));
vi.mock("@/server/db/idempotency-repo", () => ({ prismaIdempotencyRepository: {} }));
vi.mock("@/server/services/idempotency.service", () => ({ executeIdempotentDbOperation }));

import {
  archiveFamilyPlanet,
  createFamilyPlanet,
  createFamilyRelationship,
  restoreFamilyPlanet,
  updateFamilyPlanet,
} from "./planet.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };

function planet(overrides: Record<string, unknown> = {}) {
  return {
    id: "planet-1",
    userId: scope.userId,
    galaxyId: scope.galaxyId,
    name: "妈妈",
    type: "parent",
    lifeState: "active",
    visibility: "family",
    role: null,
    theme: null,
    summary: null,
    positionX: null,
    positionY: null,
    coverAssetId: null,
    version: 2,
    archivedAt: null,
    deletedAt: null,
    purgeAfter: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides,
  };
}

async function runIdempotentOperation() {
  executeIdempotentDbOperation.mockImplementation(async (_database, _repo, _input, operation) => {
    const completion = await operation({} as never, "operation-1");
    return {
      kind: "completed",
      operationId: "operation-1",
      response: completion.response,
      status: completion.responseStatus,
    };
  });
}

describe("planet service", () => {
  beforeEach(() => {
    getPrismaClient.mockReset();
    archivePlanet.mockReset();
    createPlanet.mockReset();
    createPlanetRelationship.mockReset();
    lockReadableCoverAsset.mockReset();
    findActivePlanet.mockReset();
    findActiveRelationship.mockReset();
    findScopedPlanet.mockReset();
    isPlanetUniqueConstraintError.mockReset();
    lockActivePlanetsForRelationship.mockReset();
    restorePlanet.mockReset();
    updateActivePlanet.mockReset();
    executeIdempotentDbOperation.mockReset();
  });

  it("creates a family planet inside the administrator scope through the idempotency transaction", async () => {
    await runIdempotentOperation();
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    createPlanet.mockResolvedValue(planet({ id: "planet-new", version: 1 }));

    const result = await createFamilyPlanet(scope, {
      name: "爸爸",
      type: "parent",
      visibility: "family",
      position: { x: 18, y: 36 },
      idempotencyKey: "create-family-planet-0001",
    });

    expect(createPlanet).toHaveBeenCalledWith({
      userId: "user-1",
      galaxyId: "galaxy-1",
      name: "爸爸",
      type: "parent",
      lifeState: "active",
      visibility: "family",
      role: undefined,
      theme: undefined,
      summary: undefined,
      positionX: 18,
      positionY: 36,
    }, expect.anything());
    expect(executeIdempotentDbOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        galaxyId: "galaxy-1",
        scope: "planet:create",
        key: "create-family-planet-0001",
      }),
      expect.any(Function),
    );
    expect(result).toMatchObject({ kind: "completed", status: 201, response: { id: "planet-new" } });
  });

  it("hashes semantically identical create payloads consistently for idempotency", async () => {
    await runIdempotentOperation();
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    createPlanet.mockResolvedValue(planet({ id: "planet-new", version: 1 }));

    await createFamilyPlanet(scope, {
      name: "爸爸",
      type: "parent",
      visibility: "family",
      position: { x: 18, y: 36 },
      idempotencyKey: "stable-create-key-00001",
    });
    await createFamilyPlanet(scope, {
      visibility: "family",
      position: { y: 36, x: 18 },
      type: "parent",
      name: "爸爸",
      idempotencyKey: "stable-create-key-00001",
    });

    expect(executeIdempotentDbOperation.mock.calls[0]?.[2]).toMatchObject({
      requestHash: executeIdempotentDbOperation.mock.calls[1]?.[2]?.requestHash,
    });
  });

  it("switches to memorial through lifeState without rewriting Planet.type or deleting relationships", async () => {
    findActivePlanet.mockResolvedValue(planet({ type: "parent" }));
    updateActivePlanet.mockResolvedValue(planet({ lifeState: "memorial", visibility: "private", version: 3 }));

    await updateFamilyPlanet(scope, "planet-1", { version: 2, lifeState: "memorial" });

    expect(updateActivePlanet).toHaveBeenCalledWith({
      ...scope,
      planetId: "planet-1",
      version: 2,
      data: { lifeState: "memorial", visibility: "private" },
    });
    expect(createPlanetRelationship).not.toHaveBeenCalled();
  });

  it("keeps an explicitly supplied visibility when switching to memorial", async () => {
    findActivePlanet.mockResolvedValue(planet());
    updateActivePlanet.mockResolvedValue(planet({ lifeState: "memorial", visibility: "family" }));

    await updateFamilyPlanet(scope, "planet-1", {
      version: 2,
      lifeState: "memorial",
      visibility: "family",
    });

    expect(updateActivePlanet).toHaveBeenCalledWith(expect.objectContaining({
      data: { lifeState: "memorial", visibility: "family" },
    }));
  });

  it("returns a legacy memorial type as the memorial lifecycle on compatible reads", async () => {
    findActivePlanet.mockResolvedValue(planet({ type: "memorial", lifeState: "active" }));
    updateActivePlanet.mockResolvedValue(planet({ type: "memorial", lifeState: "active", name: "外婆" }));

    await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, name: "外婆" }))
      .resolves.toMatchObject({ type: "memorial", lifeState: "memorial" });
  });

  it("rejects a cover that is not a readable current-planet image without changing the planet", async () => {
    findActivePlanet.mockResolvedValue(planet());
    getPrismaClient.mockReturnValue({ $transaction: vi.fn(async (operation) => operation({})) });
    lockReadableCoverAsset.mockResolvedValue([]);
    await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, coverAssetId: "asset-1" }))
      .rejects.toMatchObject({ code: "PLANET_COVER_INVALID", status: 400 });

    await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, coverAssetId: "asset-2" }))
      .rejects.toMatchObject({ code: "PLANET_COVER_INVALID", status: 400 });
    expect(updateActivePlanet).not.toHaveBeenCalled();
  });

  for (const status of ["processing", "failed"] as const) {
    it(`rejects a ${status} cover asset before changing the planet`, async () => {
      findActivePlanet.mockResolvedValue(planet());
      lockReadableCoverAsset.mockResolvedValue([]);
      getPrismaClient.mockReturnValue({ $transaction: vi.fn(async (operation) => operation({})) });
      updateActivePlanet.mockResolvedValue(planet({ coverAssetId: "asset-1", version: 3 }));

      await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, coverAssetId: "asset-1" }))
        .rejects.toMatchObject({ code: "PLANET_COVER_INVALID", status: 400 });

      expect(updateActivePlanet).not.toHaveBeenCalled();
    });
  }

  it("locks a readable cover inside the transaction before applying the scoped planet update", async () => {
    const transaction = {};
    const $transaction = vi.fn(async (operation) => operation(transaction));
    const order: string[] = [];
    getPrismaClient.mockReturnValue({ $transaction });
    findActivePlanet.mockResolvedValue(planet());
    lockReadableCoverAsset.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      order.push("lock");
      return [{ id: "asset-1" }];
    });
    updateActivePlanet.mockImplementation(async (_input, client) => {
      expect(client).toBe(transaction);
      order.push("update");
      return planet({ coverAssetId: "asset-1", version: 3 });
    });

    await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, coverAssetId: "asset-1" }))
      .resolves.toMatchObject({ coverAssetId: "asset-1", version: 3 });

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(lockReadableCoverAsset).toHaveBeenCalledWith({
      ...scope,
      planetId: "planet-1",
      assetId: "asset-1",
    }, transaction);
    expect(updateActivePlanet).toHaveBeenCalledWith({
      ...scope,
      planetId: "planet-1",
      version: 2,
      data: { coverAssetId: "asset-1" },
    }, transaction);
    expect(order).toEqual(["lock", "update"]);
  });

  it("clears a cover without opening a cover-asset transaction", async () => {
    const $transaction = vi.fn();
    getPrismaClient.mockReturnValue({ $transaction });
    findActivePlanet.mockResolvedValue(planet({ coverAssetId: "asset-1" }));
    updateActivePlanet.mockResolvedValue(planet({ coverAssetId: null, version: 3 }));

    await updateFamilyPlanet(scope, "planet-1", { version: 2, coverAssetId: null });

    expect(lockReadableCoverAsset).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
    expect(updateActivePlanet).toHaveBeenCalledWith({
      ...scope,
      planetId: "planet-1",
      version: 2,
      data: { coverAssetId: null },
    });
  });

  it("archives with the scoped optimistic version instead of physically deleting", async () => {
    findActivePlanet.mockResolvedValue(planet());
    archivePlanet.mockResolvedValue(undefined);

    await archiveFamilyPlanet(scope, "planet-1", 2);

    expect(archivePlanet).toHaveBeenCalledWith({ ...scope, planetId: "planet-1", version: 2 });
  });

  it("restores only an archived planet inside the administrator scope", async () => {
    findScopedPlanet.mockResolvedValue(planet({ archivedAt: new Date(), deletedAt: new Date(), purgeAfter: new Date() }));
    restorePlanet.mockResolvedValue(undefined);

    await restoreFamilyPlanet(scope, "planet-1", 2);

    expect(restorePlanet).toHaveBeenCalledWith({ ...scope, planetId: "planet-1", version: 2 });
  });

  it("preserves the exact optimistic-lock conflict response contract", async () => {
    findActivePlanet.mockResolvedValue(planet());
    updateActivePlanet.mockRejectedValue(new DomainError(
      "VERSION_CONFLICT",
      409,
      "这颗星球已在另一处更新，请刷新后重试。",
    ));

    await expect(updateFamilyPlanet(scope, "planet-1", { version: 2, name: "新名字" }))
      .rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        status: 409,
        message: "这颗星球已在另一处更新，请刷新后重试。",
      });
  });

  it("creates a real same-galaxy relationship only after locking both active planets in its idempotent callback", async () => {
    await runIdempotentOperation();
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    lockActivePlanetsForRelationship.mockResolvedValue([{ id: "planet-1" }, { id: "planet-2" }]);
    findActiveRelationship.mockResolvedValue(null);
    createPlanetRelationship.mockResolvedValue({ id: "relationship-1" });

    const result = await createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-2",
      relationshipType: "parent",
      visibility: "family",
      label: "母女",
      idempotencyKey: "create-relationship-0001",
    });

    expect(lockActivePlanetsForRelationship).toHaveBeenCalledWith({
      ...scope,
      sourcePlanetId: "planet-1",
      targetPlanetId: "planet-2",
    }, expect.anything());
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(findActiveRelationship).toHaveBeenCalledWith({
      ...scope,
      sourcePlanetId: "planet-1",
      targetPlanetId: "planet-2",
      relationshipType: "parent",
    }, expect.anything());
    expect(createPlanetRelationship).toHaveBeenCalledWith({
      ...scope,
      sourcePlanetId: "planet-1",
      targetPlanetId: "planet-2",
      relationshipType: "parent",
      visibility: "family",
      label: "母女",
    }, expect.anything());
    expect(result).toMatchObject({ kind: "completed", status: 201, response: { id: "relationship-1" } });
  });

  it("replays a completed relationship after an archive would make the active lock fail", async () => {
    getPrismaClient.mockReturnValue({ $transaction: vi.fn() });
    lockActivePlanetsForRelationship
      .mockResolvedValueOnce([{ id: "planet-1" }, { id: "planet-2" }])
      .mockResolvedValueOnce([{ id: "planet-2" }]);
    findActiveRelationship.mockResolvedValue(null);
    createPlanetRelationship.mockResolvedValue({ id: "relationship-1" });
    await runIdempotentOperation();

    await expect(createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-2",
      relationshipType: "parent",
      visibility: "private",
      idempotencyKey: "relationship-replay-key01",
    })).resolves.toMatchObject({ kind: "completed", status: 201, response: { id: "relationship-1" } });

    executeIdempotentDbOperation.mockResolvedValueOnce({
      kind: "completed",
      operationId: "relationship-op-existing",
      status: 201,
      response: { id: "relationship-1" },
    });

    await expect(createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-2",
      relationshipType: "parent",
      visibility: "private",
      idempotencyKey: "relationship-replay-key01",
    })).resolves.toMatchObject({ kind: "completed", status: 201, response: { id: "relationship-1" } });

    expect(lockActivePlanetsForRelationship).toHaveBeenCalledTimes(1);
    expect(findActivePlanet).not.toHaveBeenCalled();
    expect(findActiveRelationship).toHaveBeenCalledTimes(1);
    expect(createPlanetRelationship).toHaveBeenCalledTimes(1);
  });

  it("rejects self and duplicate relationship attempts without leaking a unique error", async () => {
    await expect(createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-1",
      relationshipType: "self",
      visibility: "private",
      idempotencyKey: "self-relationship-00001",
    })).rejects.toMatchObject({ code: "RELATIONSHIP_SELF_LINK", status: 400 });

    lockActivePlanetsForRelationship.mockResolvedValue([{ id: "planet-1" }, { id: "planet-2" }]);
    findActiveRelationship.mockResolvedValue({ id: "relationship-1" });
    await runIdempotentOperation();
    await expect(createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-2",
      relationshipType: "parent",
      visibility: "private",
      idempotencyKey: "duplicate-relationship01",
    })).rejects.toMatchObject({ code: "RELATIONSHIP_EXISTS", status: 409 });
  });

  it("rejects a relationship when its transaction lock finds one archived planet", async () => {
    lockActivePlanetsForRelationship.mockResolvedValue([{ id: "planet-1" }]);
    findActiveRelationship.mockResolvedValue(null);
    await runIdempotentOperation();
    await expect(createFamilyRelationship(scope, "planet-1", {
      targetPlanetId: "planet-foreign",
      relationshipType: "parent",
      visibility: "private",
      idempotencyKey: "foreign-relationship0001",
    })).rejects.toMatchObject({ code: "PLANET_NOT_FOUND", status: 404 });
    expect(findActiveRelationship).not.toHaveBeenCalled();
    expect(createPlanetRelationship).not.toHaveBeenCalled();
  });
});
