import { afterEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

const { BookNewClientPage } = vi.hoisted(() => ({
  BookNewClientPage: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/features/demo-loop/book-new-client-page", () => ({ BookNewClientPage }));

import NewBookPage from "./page";

describe("NewBookPage", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects even with a legacy resonance cache, without reading storage or requesting a book", () => {
    localStorage.setItem("jiashu-demo-resonance", JSON.stringify({ candidates: [{ id: "legacy" }] }));
    const readLocalStorage = vi.spyOn(Storage.prototype, "getItem");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(() => NewBookPage()).toThrow("REDIRECT:/galaxy");
    expect(redirect).toHaveBeenCalledWith("/galaxy");
    expect(readLocalStorage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(BookNewClientPage).not.toHaveBeenCalled();
  });
});
