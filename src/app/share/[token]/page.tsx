import { notFound } from "next/navigation";

import { getSharedBook } from "@/server/store/shared-books";

const themeLabels: Record<string, string> = {
  family_reunion: "家庭团圆",
  parent_story: "父母人生",
  child_growth: "亲子成长",
  travel: "旅行星云",
};

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

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#15100f_0%,#182322_50%,#211a25_100%)] px-5 py-10 text-stone-50 md:px-8">
      <article className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
            家书星球 · 公开分享
          </p>
          <h1 className="mt-3 font-serif text-3xl font-semibold md:text-4xl">{draft.title}</h1>
          <p className="mt-2 text-sm text-stone-400">
            主题：{themeLabels[draft.themeTemplateKey] ?? draft.themeTemplateKey}
          </p>
        </header>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
          <p className="text-sm leading-7 text-stone-300">{draft.intro}</p>
        </section>

        {share.showBody ? (
          <div className="space-y-5">
            {sections.map((section) => (
              <section
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
                key={section.title}
              >
                <h2 className="font-serif text-xl font-semibold text-amber-50">{section.title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-300">{section.body}</p>
                {share.showSourceTitles ? (
                  <p className="mt-4 text-xs tracking-[0.12em] text-stone-500">
                    来源记忆：{section.sourceMemoryIds.join(" / ")}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-stone-400">
            分享者未开放家书正文。
          </p>
        )}

        {share.showOriginalText ? (
          <section className="mt-8 rounded-2xl border border-white/10 bg-stone-950/40 p-6">
            <p className="text-xs uppercase tracking-[0.16em] text-stone-500">原始生成全文</p>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-stone-400">{body}</p>
          </section>
        ) : null}

        <footer className="mt-10 border-t border-white/10 pt-6 text-xs text-stone-500">
          <p>这页家书只公开已选章节，不会公开整颗星球或其它私密记忆。</p>
          <p className="mt-2">分享于 {new Date(stored.createdAt).toLocaleString("zh-CN")}</p>
        </footer>
      </article>
    </main>
  );
}
