"use client";

import { useRef, useState } from "react";
import { BookOpenText, Download, ImageIcon, LoaderCircle, Music2, Quote } from "lucide-react";

import type { FamilyBookMedia, FamilyBookSection } from "@/shared/types/family-book";

import styles from "./family-book-reader.module.css";

type FamilyBookReaderProps = {
  body: string;
  intro: string;
  media: FamilyBookMedia[];
  sections: FamilyBookSection[];
  sourceLabels: Record<string, string>;
  title: string;
  className?: string;
};

export function FamilyBookReader({
  body,
  className,
  intro,
  media,
  sections,
  sourceLabels,
  title,
}: FamilyBookReaderProps) {
  const bookRef = useRef<HTMLElement>(null);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "failed">("idle");
  const imageMedia = media.filter((item) => item.kind === "image");
  const audioMedia = media.filter((item) => item.kind === "audio");
  const narrativeSections = sections.length > 0
    ? sections
    : [{ title: "写给未来的我们", body, sourceMemoryIds: [] }];

  async function exportKeepsakePdf() {
    const book = bookRef.current;
    if (!book || exportState === "exporting") return;

    setExportState("exporting");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const spreads = [...book.querySelectorAll<HTMLElement>("[data-family-book-spread]")];
      if (spreads.length === 0) throw new Error("没有可导出的纪念册页面。");

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
      for (const [index, spread] of spreads.entries()) {
        const canvas = await html2canvas(spread, {
          backgroundColor: "#f8edd8",
          logging: false,
          scale: 2,
          useCORS: true,
          onclone: (document) => {
            document.querySelectorAll("audio").forEach((audio) => audio.remove());
          },
        });
        if (index > 0) pdf.addPage("a4", "landscape");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imageHeight = Math.min(pageHeight, pageWidth / (canvas.width / canvas.height));
        const imageWidth = imageHeight * (canvas.width / canvas.height);
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight, undefined, "FAST");
      }
      pdf.save(`${toPdfFileName(title)}.pdf`);
      setExportState("idle");
    } catch {
      setExportState("failed");
    }
  }

  return (
    <section className={[styles.stage, className].filter(Boolean).join(" ")}>
      <div className={styles.toolbar} data-html2canvas-ignore="true">
        <p><BookOpenText aria-hidden="true" size={16} /> 家书纪念册 · 已保存版本</p>
        <button
          aria-label="下载 PDF 纪念册"
          className={styles.exportButton}
          disabled={exportState === "exporting"}
          onClick={() => void exportKeepsakePdf()}
          type="button"
        >
          {exportState === "exporting" ? <LoaderCircle aria-hidden="true" className={styles.spinning} size={17} /> : <Download aria-hidden="true" size={17} />}
          {exportState === "exporting" ? "正在装订 PDF…" : "下载 PDF 纪念册"}
        </button>
      </div>
      {exportState === "failed" ? <p className={styles.exportError} role="alert">PDF 导出暂未完成，请确认图片加载完成后重试。</p> : null}

      <article aria-label="家书纪念册预览" className={styles.book} ref={bookRef}>
        <div className={[styles.spread, styles.openingSpread].join(" ")} data-family-book-spread>
          <section className={[styles.page, styles.coverPage].join(" ")}>
            <span className={styles.coverEyebrow}>家书星球 · 家庭私藏</span>
            <div className={styles.coverOrbit} aria-hidden="true"><i /><i /><i /></div>
            <h1>{title}</h1>
            <p>留给未来的家人</p>
          </section>
          <section className={[styles.page, styles.insideCover].join(" ")}>
            <span className={styles.pageNumber}>序 · 01</span>
            <Quote aria-hidden="true" className={styles.quoteMark} size={34} />
            <p className={styles.intro}>{intro}</p>
            <div className={styles.insideRule} />
            <p className={styles.insideNote}>翻开的不是纸页，是我们曾经一起走过的日子。</p>
          </section>
        </div>

        {narrativeSections.map((section, index) => {
          const image = imageMedia[index % imageMedia.length];
          const audio = audioMedia[index % audioMedia.length];
          const isImageOnLeft = index % 2 === 0;
          return (
            <div className={styles.spread} data-family-book-spread key={`${section.title}-${index}`}>
              <BookNarrativePage
                audio={audio}
                image={isImageOnLeft ? image : undefined}
                index={index}
                section={section}
                sourceLabels={sourceLabels}
              />
              <BookNarrativePage
                audio={isImageOnLeft ? undefined : audio}
                image={isImageOnLeft ? undefined : image}
                index={index}
                section={section}
                sourceLabels={sourceLabels}
                continuation
              />
            </div>
          );
        })}

        <div className={[styles.spread, styles.closingSpread].join(" ")} data-family-book-spread>
          <section className={[styles.page, styles.letterPage].join(" ")}>
            <span className={styles.pageNumber}>附言</span>
            <p className={styles.letterLabel}>写给未来的我们</p>
            <p className={styles.letterBody}>{body}</p>
          </section>
          <section className={[styles.page, styles.lastPage].join(" ")}>
            <div className={styles.lastPageEmblem} aria-hidden="true"><span /><span /><span /></div>
            <p>愿灯火一直在</p>
            <small>家书星球 · 为每一次回望留一颗星</small>
          </section>
        </div>
      </article>
    </section>
  );
}

function BookNarrativePage({
  audio,
  continuation = false,
  image,
  index,
  section,
  sourceLabels,
}: {
  audio?: FamilyBookMedia;
  continuation?: boolean;
  image?: FamilyBookMedia;
  index: number;
  section: FamilyBookSection;
  sourceLabels: Record<string, string>;
}) {
  const labels = (section.sourceMemoryIds ?? [])
    .map((memoryId) => sourceLabels[memoryId])
    .filter((label): label is string => Boolean(label));
  const lead = leadParagraph(section.body);
  const pageBody = continuation ? section.body.slice(lead.length).trim() : lead;

  return (
    <section className={[styles.page, continuation ? styles.continuationPage : styles.storyPage].join(" ")}>
      <span className={styles.pageNumber}>{String(index + 2).padStart(2, "0")}</span>
      {image ? (
        <figure className={styles.photoFrame}>
          <ImageIcon aria-hidden="true" className={styles.photoGlyph} size={16} />
          <img
            alt={`${image.title}：${image.caption}`}
            decoding="async"
            loading="lazy"
            src={image.url}
            style={image.width && image.height ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
          />
          <figcaption>{image.caption || image.title}</figcaption>
        </figure>
      ) : null}
      {pageBody ? (
        <div className={styles.storyCopy}>
          {!continuation ? <h2>{section.title}</h2> : <p className={styles.continuationTitle}>续 · {section.title}</p>}
          <p>{pageBody}</p>
        </div>
      ) : null}
      {!continuation && labels.length > 0 ? <p className={styles.sources}>{labels.map((label) => `来源 · ${label}`).join("  ·  ")}</p> : null}
      {audio ? <VoiceCard audio={audio} /> : null}
    </section>
  );
}

function VoiceCard({ audio }: { audio: FamilyBookMedia }) {
  return (
    <aside className={styles.voiceCard}>
      <div className={styles.voiceIcon}><Music2 aria-hidden="true" size={18} /></div>
      <div>
        <span>声音夹页</span>
        <strong>{audio.title}</strong>
        <small>{audio.durationMs ? formatDuration(audio.durationMs) : "声音记忆"} · {audio.caption || audio.originalName}</small>
      </div>
      <audio aria-label={`播放声音记忆：${audio.title}`} controls preload="metadata" src={audio.url} />
    </aside>
  );
}

function leadParagraph(value: string) {
  const breakpoint = value.search(/[。！？]/);
  return breakpoint >= 0 ? value.slice(0, breakpoint + 1) : value;
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function toPdfFileName(value: string) {
  const safe = value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 80);
  return safe || "家书纪念册";
}
