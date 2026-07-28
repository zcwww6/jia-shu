import { notFound } from "next/navigation";

import { FamilyBookReader } from "@/features/books/family-book-reader";
import { getSharedBook } from "@/server/store/shared-books";

export default async function SharedBookPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const stored = await getSharedBook(token);

  if (!stored) {
    notFound();
  }

  const { draft, body, sections, share } = stored;
  // Legacy shared-book snapshots deliberately retain only source IDs. Do not
  // reach into the private book draft to enrich them on this public route.
  const sourceLabels = share.showSourceTitles ? Object.fromEntries(sections.flatMap((section) => (
    section.sourceMemoryIds.map((memoryId) => [memoryId, memoryId])
  ))) : {};
  const publicBody = share.showOriginalText
    ? body
    : "愿这封家书只留下被郑重选择的章节，也把未被公开的故事安静留在家人身边。";

  return (
    <main className="min-h-screen bg-[#1f1713] px-4 py-7 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs tracking-[0.12em] text-amber-100/70">
          <p>家书星球 · 公开分享</p>
          <p>分享于 {new Date(stored.createdAt).toLocaleString("zh-CN")}</p>
        </header>
        {share.showBody ? (
          <FamilyBookReader
            body={publicBody}
            intro={draft.intro}
            media={[]}
            sections={sections}
            sourceLabels={sourceLabels}
            title={draft.title}
          />
        ) : (
          <section className="rounded-[28px] border border-amber-100/15 bg-[#30231d] px-8 py-14 text-center text-sm leading-7 text-amber-50/70">
            分享者未开放家书正文。
          </section>
        )}
        <footer className="mt-8 text-center text-xs leading-6 text-amber-50/45">
          这页家书只公开已选章节，不会公开整颗星球或其它私密记忆。
        </footer>
      </div>
    </main>
  );
}
