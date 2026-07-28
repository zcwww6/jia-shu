import { afterEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect }));

import PrivacyPage from "./page";

describe("PrivacyPage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects legacy privacy links to Galaxy without reading legacy book or share caches", () => {
    localStorage.setItem("jiashu-demo-book", JSON.stringify({ title: "不应恢复的旧家书" }));
    localStorage.setItem("jiashu-demo-share", JSON.stringify({ showBody: true }));
    const readLocalStorage = vi.spyOn(Storage.prototype, "getItem");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => PrivacyPage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
    expect(readLocalStorage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
