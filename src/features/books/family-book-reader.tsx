"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BookOpenText, ChevronLeft, ChevronRight, Download, ImageIcon, LoaderCircle, Music2, Quote } from "lucide-react";

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
  onConfirmSpread?: (pageIndex: number) => void;
  reviewedSpreadIndexes?: number[];
  reviewingSpread?: boolean;
};

export function FamilyBookReader({
  body,
  className,
  intro,
  media,
  onConfirmSpread,
  reviewedSpreadIndexes = [],
  reviewingSpread = false,
  sections,
  sourceLabels,
  title,
}: FamilyBookReaderProps) {
  const exportBookRef = useRef<HTMLElement>(null);
  const [exportState, setExportState] = useState<"idle" | "exporting" | "failed">("idle");
  const [activeSpread, setActiveSpread] = useState(0);
  const [turnDirection, setTurnDirection] = useState<"forward" | "backward">("forward");
  const reduceMotion = useReducedMotion() ?? false;
  const imageMedia = media.filter((item) => item.kind === "image");
  const audioMedia = media.filter((item) => item.kind === "audio");
  const narrativeSections = sections.length > 0
    ? sections
    : [{ title: "写给未来的我们", body, sourceMemoryIds: [] }];
  const spreadCount = narrativeSections.length + 2;
  const nextReviewPageIndex = reviewedSpreadIndexes.length;
  const reviewComplete = nextReviewPageIndex >= spreadCount;
  const turnOffset = turnDirection === "forward" ? 34 : -34;
  const turnRotation = turnDirection === "forward" ? 12 : -12;
  const enter = reduceMotion ? { opacity: 0 } : { opacity: 0, rotateY: turnRotation, x: turnOffset };
  const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, rotateY: -turnRotation, x: -turnOffset };
  const settled = reduceMotion ? { opacity: 1 } : { opacity: 1, rotateY: 0, x: 0 };

  function turnTo(next: number) {
    const nextSpread = Math.min(Math.max(next, 0), spreadCount - 1);
    if (nextSpread === activeSpread) return;

    setTurnDirection(nextSpread > activeSpread ? "forward" : "backward");
    setActiveSpread(nextSpread);
  }

  function onReaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      turnTo(activeSpread - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      turnTo(activeSpread + 1);
    }
  }

  async function exportKeepsakePdf() {
    const book = exportBookRef.current;
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
        <div className={styles.toolbarActions}>
          <span aria-live="polite" className={styles.pageIndicator}>第 {activeSpread + 1} / {spreadCount} 页</span>
          {onConfirmSpread ? (
            <>
              <span className={styles.reviewHint} aria-live="polite">
                {reviewComplete ? "全书已逐页确认，可以创建分享链接。" : `请依序确认第 ${nextReviewPageIndex + 1} / ${spreadCount} 页`}
              </span>
              <button
                aria-label={`确认第 ${activeSpread + 1} 页`}
                className={styles.reviewButton}
                disabled={reviewingSpread || reviewComplete || activeSpread !== nextReviewPageIndex}
                onClick={() => onConfirmSpread(activeSpread)}
                type="button"
              >
                {reviewingSpread ? "正在确认…" : `确认第 ${activeSpread + 1} 页`}
              </button>
            </>
          ) : null}
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
      </div>
      {exportState === "failed" ? <p className={styles.exportError} role="alert">PDF 导出暂未完成，请确认图片加载完成后重试。</p> : null}

      <article
        aria-label="家书纪念册预览"
        aria-roledescription="可翻页家书"
        className={styles.book}
        onKeyDown={onReaderKeyDown}
        tabIndex={0}
      >
        <div className={styles.visibleSpread} data-spread-index={activeSpread} data-testid="visible-family-book-spread">
          <AnimatePresence initial={false}>
            <motion.div
              animate={settled}
              className={styles.turningSpread}
              exit={exit}
              initial={enter}
              key={activeSpread}
              transition={{ duration: reduceMotion ? 0.16 : 0.34, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <BookSpread
                body={body}
                imageMedia={imageMedia}
                index={activeSpread}
                intro={intro}
                narrativeSections={narrativeSections}
                sourceLabels={sourceLabels}
                title={title}
                audioMedia={audioMedia}
              />
            </motion.div>
          </AnimatePresence>
        </div>
        <div className={styles.readerControls} data-html2canvas-ignore="true">
          <button aria-label="上一页" className={styles.turnButton} disabled={activeSpread === 0} onClick={() => turnTo(activeSpread - 1)} type="button">
            <ChevronLeft aria-hidden="true" size={18} /> 上一页
          </button>
          <span className={styles.readerHint}>可使用方向键翻页</span>
          <button aria-label="下一页" className={styles.turnButton} disabled={activeSpread === spreadCount - 1} onClick={() => turnTo(activeSpread + 1)} type="button">
            下一页 <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>
      </article>

      <article aria-hidden="true" className={styles.exportBook} ref={exportBookRef}>
        {Array.from({ length: spreadCount }, (_, index) => (
          <BookSpread
            audioMedia={audioMedia}
            body={body}
            imageMedia={imageMedia}
            index={index}
            intro={intro}
            key={`export-spread-${index}`}
            narrativeSections={narrativeSections}
            sourceLabels={sourceLabels}
            title={title}
          />
        ))}
      </article>
    </section>
  );
}

function BookSpread({
  audioMedia,
  body,
  imageMedia,
  index,
  intro,
  narrativeSections,
  sourceLabels,
  title,
}: {
  audioMedia: FamilyBookMedia[];
  body: string;
  imageMedia: FamilyBookMedia[];
  index: number;
  intro: string;
  narrativeSections: FamilyBookSection[];
  sourceLabels: Record<string, string>;
  title: string;
}) {
  if (index === 0) {
    return (
      <div className={[styles.spread, styles.openingSpread].join(" ")} data-family-book-spread data-spread-index={index}>
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
    );
  }

  const narrativeIndex = index - 1;
  if (narrativeIndex < narrativeSections.length) {
    const section = narrativeSections[narrativeIndex]!;
    const image = imageMedia[narrativeIndex % imageMedia.length];
    const audio = audioMedia[narrativeIndex % audioMedia.length];
    const isImageOnLeft = narrativeIndex % 2 === 0;
    return (
      <div className={styles.spread} data-family-book-spread data-spread-index={index}>
        <BookNarrativePage
          audio={audio}
          image={isImageOnLeft ? image : undefined}
          index={narrativeIndex}
          section={section}
          sourceLabels={sourceLabels}
        />
        <BookNarrativePage
          audio={isImageOnLeft ? undefined : audio}
          image={isImageOnLeft ? undefined : image}
          index={narrativeIndex}
          section={section}
          sourceLabels={sourceLabels}
          continuation
        />
      </div>
    );
  }

  return (
    <div className={[styles.spread, styles.closingSpread].join(" ")} data-family-book-spread data-spread-index={index}>
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
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated memory assets use signed local API URLs. */}
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
