import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { useApp } from "@/lib/app-state";
import { STYLES, STYLE_LIST } from "@/lib/styles";
import { generateNoteWithAi, AiNotConfiguredError } from "@/lib/ai-generate";
import type { GeneratedNote, PageDesign, PageLayout, StickerOverlay } from "@/lib/types";
import { PageEditor } from "@/components/page-editor";
import { PageFlat } from "@/components/page-flat";
import { PhonePreview } from "@/components/phone-preview";
import { XhsImport } from "@/components/xhs-import";
import {
  exportPagesAsZip,
  exportPagesSequentially,
  renderPageDesignToPng,
} from "@/lib/export-pages";
import {
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  AlertTriangle,
  Sparkles,
  Plus,
  Trash2,
  X,
} from "lucide-react";

const EXPORT_WIDTH = 720; // px (3:4 aspect → 720x960)

export default function ResultPage() {
  const app = useApp();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [exportState, setExportState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState<string>("");
  const exportRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!app.generated) navigate("/create");
  }, [app.generated, navigate]);

  if (!app.generated) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-24 text-center text-muted-foreground" data-testid="empty-result">
          还未生成笔记,正在返回素材输入页…
        </div>
      </AppShell>
    );
  }

  const note = app.generated;
  const style = STYLES[note.styleKey];

  function updateNote(patch: Partial<GeneratedNote>) {
    if (!app.generated) return;
    app.setGenerated({ ...app.generated, ...patch });
  }

  function updatePageDesign(index: number, design: PageDesign) {
    if (!app.generated) return;
    const pageDesigns = { ...app.generated.pageDesigns, [index]: design };
    const next: GeneratedNote = {
      ...app.generated,
      pageDesigns,
      cover: index === 0 ? design : app.generated.cover,
    };
    app.setGenerated(next);
  }
  function updateStickers(next: StickerOverlay[]) {
    updateNote({ stickers: next });
  }

  // Append a new blank image page to the deck. Each click creates exactly one
  // new page that is image/background-only — a gradient placeholder, no text,
  // no stickers. The new page is appended after the last existing page,
  // becomes selectable, and is automatically picked up by phone preview and
  // export because they read from note.pageLayout / note.pageDesigns.
  // Remove the currently selected page from the deck. Guards against removing
  // the last remaining page so the editor always has something to render, and
  // keeps the user pointed at a valid neighbor after deletion. Stickers bound
  // to the deleted page are dropped; designs for other pages are preserved.
  function deleteSelectedPage() {
    if (!app.generated) return;
    const pages = app.generated.pageLayout;
    if (pages.length <= 1) return;
    const removeIndex = selectedPageIndex;
    const removeOrd = pages.findIndex((p) => p.index === removeIndex);
    if (removeOrd < 0) return;
    const nextPages = pages.filter((p) => p.index !== removeIndex);
    const nextDesigns: Record<number, PageDesign> = {};
    for (const [k, v] of Object.entries(app.generated.pageDesigns)) {
      const n = Number(k);
      if (n !== removeIndex) nextDesigns[n] = v;
    }
    const nextStickers = app.generated.stickers.filter(
      (s) => s.pageIndex !== removeIndex,
    );
    const neighbor = nextPages[Math.min(removeOrd, nextPages.length - 1)];
    const next: GeneratedNote = {
      ...app.generated,
      pageLayout: nextPages,
      pageDesigns: nextDesigns,
      stickers: nextStickers,
      cover:
        removeIndex === 0 && nextPages[0]
          ? nextDesigns[nextPages[0].index] || app.generated.cover
          : app.generated.cover,
    };
    app.setGenerated(next);
    setSelectedPageIndex(neighbor.index);
  }

  function addBlankPage() {
    if (!app.generated) return;
    const style = STYLES[app.generated.styleKey];
    const palette = style.palette;
    const existingIndices = app.generated.pageLayout.map((p) => p.index);
    const nextIndex = (existingIndices.length ? Math.max(...existingIndices) : 0) + 1;
    const ord = app.generated.pageLayout.length;
    const angles = [135, 160, 110, 200, 45];
    const ang = angles[ord % angles.length];
    const a = palette[ord % palette.length];
    const b = palette[(ord + 1) % palette.length];
    const c = palette[(ord + 2) % palette.length];
    const gradient = `linear-gradient(${ang}deg, ${a} 0%, ${b} 55%, ${c} 100%)`;
    const newPage: PageLayout = {
      index: nextIndex,
      role: "custom",
      headline: "",
      caption: "",
      gradient,
    };
    const newDesign: PageDesign = {
      background: gradient,
      bgImageUrl: null,
      layers: [],
    };
    const next: GeneratedNote = {
      ...app.generated,
      pageLayout: [...app.generated.pageLayout, newPage],
      pageDesigns: { ...app.generated.pageDesigns, [nextIndex]: newDesign },
    };
    app.setGenerated(next);
    setSelectedPageIndex(nextIndex);
  }

  // Normalize a user-entered tag: trim, strip a leading "#"/"＃" if any, then
  // re-prefix with a single "#". Empty/whitespace-only input returns "".
  function normalizeTag(raw: string): string {
    const cleaned = raw.replace(/^[#＃\s]+/, "").trim();
    return cleaned ? `#${cleaned}` : "";
  }

  function addTag() {
    if (!app.generated) return;
    const v = normalizeTag(tagDraft);
    if (!v) return;
    if (app.generated.tags.includes(v)) {
      setTagDraft("");
      return;
    }
    updateNote({ tags: [...app.generated.tags, v] });
    setTagDraft("");
  }

  function removeTag(tag: string) {
    if (!app.generated) return;
    updateNote({ tags: app.generated.tags.filter((t) => t !== tag) });
  }

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
    });
  }

  // True while we're calling the AI route from the result page (regenerate
  // text / switch style). Buttons are disabled during this window so users
  // don't fire concurrent requests.
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      const next = await generateNoteWithAi(app.state);
      app.setGenerated(next);
      setSelectedPageIndex(0);
    } catch (err) {
      console.error("Regenerate failed", err);
      const msg =
        err instanceof AiNotConfiguredError
          ? err.message
          : (err as Error)?.message || "AI 重新生成失败。";
      setRegenError(msg);
    } finally {
      setRegenerating(false);
    }
  }

  async function switchStyle(key: keyof typeof STYLES) {
    if (regenerating) return;
    app.setStyle(key);
    setRegenerating(true);
    setRegenError(null);
    try {
      const next = await generateNoteWithAi({ ...app.state, style: key });
      app.setGenerated(next);
      setSelectedPageIndex(0);
    } catch (err) {
      console.error("Switch style regenerate failed", err);
      const msg =
        err instanceof AiNotConfiguredError
          ? err.message
          : (err as Error)?.message || "AI 切换风格失败。";
      setRegenError(msg);
    } finally {
      setRegenerating(false);
    }
  }

  const currentPage =
    note.pageLayout.find((p) => p.index === selectedPageIndex) || note.pageLayout[0];
  const currentDesign: PageDesign =
    note.pageDesigns[currentPage.index] ||
    note.cover || {
      background: currentPage.gradient,
      bgImageUrl: null,
      layers: [],
    };
  const currentStickers = note.stickers.filter((s) => s.pageIndex === currentPage.index);

  async function captureAllPages(): Promise<{ name: string; dataUrl: string }[]> {
    const results: { name: string; dataUrl: string }[] = [];
    const exportHeight = Math.round((EXPORT_WIDTH * 4) / 3);
    // Wait one tick to ensure offscreen frames mounted with current state
    await new Promise((r) => setTimeout(r, 50));
    for (const page of note.pageLayout) {
      const design =
        note.pageDesigns[page.index] || {
          background: page.gradient,
          bgImageUrl: null,
          layers: [],
        };
      const pageStickers = note.stickers.filter((s) => s.pageIndex === page.index);
      const dataUrl = await renderPageDesignToPng(design, pageStickers, EXPORT_WIDTH, exportHeight);
      results.push({
        name: `notestay_page_${String(page.index + 1).padStart(2, "0")}.png`,
        dataUrl,
      });
    }
    return results;
  }

  async function handleDownloadAll(mode: "zip" | "individual") {
    setExportError(null);
    setExportState("running");
    try {
      const captures = await captureAllPages();
      if (captures.length === 0) {
        throw new Error("没有可导出的页面");
      }
      if (mode === "zip") {
        await exportPagesAsZip(captures, "notestay-pages.zip");
      } else {
        await exportPagesSequentially(captures);
      }
      setExportState("done");
      setTimeout(() => setExportState("idle"), 1600);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : "导出失败");
      setExportState("error");
    }
  }

  // Offscreen export frames at full export resolution
  const exportFrames = useMemo(
    () =>
      note.pageLayout.map((page) => {
        const design =
          note.pageDesigns[page.index] || {
            background: page.gradient,
            bgImageUrl: null,
            layers: [],
          };
        const pageStickers = note.stickers.filter((s) => s.pageIndex === page.index);
        return (
          <div
            key={page.index}
            ref={(el) => {
              exportRefs.current[page.index] = el;
            }}
            data-testid={`export-frame-${page.index}`}
          >
            <PageFlat
              design={design}
              stickers={pageStickers}
              width={EXPORT_WIDTH}
            />
          </div>
        );
      }),
    [note.pageLayout, note.pageDesigns, note.stickers],
  );

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Step 2 / 2</div>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">生成结果</h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl">
              当前风格 · <span className="font-medium text-foreground">{style.name}</span> /
              <span className="ml-1">{style.english}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="button-back-to-create"
              onClick={() => navigate("/create")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm hover-elevate"
            >
              <ChevronLeft className="size-4" /> 返回修改素材
            </button>
            <button
              type="button"
              data-testid="button-regenerate"
              onClick={regenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`size-4 ${regenerating ? "animate-spin" : ""}`} />{" "}
              {regenerating ? "AI 生成中…" : "重新生成"}
            </button>
          </div>
        </div>

        {regenError && (
          <div
            className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex gap-3 text-sm"
            data-testid="banner-regen-error"
          >
            <AlertTriangle className="size-4 mt-0.5 text-destructive shrink-0" />
            <div className="leading-relaxed text-foreground/85">
              <strong>AI 生成失败：</strong>
              {regenError}
            </div>
          </div>
        )}

        {note.warnings.length > 0 && (
          <div
            className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-100/40 dark:bg-amber-500/10 p-4 flex gap-3 text-sm"
            data-testid="banner-warnings"
          >
            <AlertTriangle className="size-4 mt-0.5 text-amber-600 dark:text-amber-300 shrink-0" />
            <ul className="space-y-1 leading-relaxed">
              {note.warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Style switcher */}
        <div className="mt-8">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-2">切换风格版本</div>
          <div className="flex gap-2 overflow-x-auto pb-2 scroll-area-hide" data-testid="row-style-switch">
            {STYLE_LIST.map((s) => {
              const active = s.key === note.styleKey;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => switchStyle(s.key)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs border transition ${
                    active
                      ? "bg-foreground text-background border-foreground"
                      : "bg-card border-card-border hover-elevate"
                  }`}
                  data-testid={`button-switch-style-${s.key}`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-8 grid lg:grid-cols-12 gap-8 items-start">
          {/* LEFT: sticky phone preview */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-24 space-y-4" data-testid="sticky-preview-pane">
              <PhonePreview
                key={note.id}
                note={note}
                pageDesigns={note.pageDesigns}
                stickers={note.stickers}
                selectedPageIndex={selectedPageIndex}
                onSelectPage={setSelectedPageIndex}
                onStickersChange={updateStickers}
                onTitleChange={(t) => updateNote({ title: t })}
                onBodyChange={(b) => updateNote({ body: b })}
              />
              <p className="text-xs text-muted-foreground text-center">
                左右滑动图片页 · 直接点击标题/正文可编辑 · 贴纸仅显示在所属页面
              </p>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="button-regenerate-text"
                >
                  <Sparkles className="size-4" /> {regenerating ? "AI 生成中…" : "重新生成文本"}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: page editor + text editors */}
          <div className="lg:col-span-7 space-y-6">
            <Block
              title="页面编辑"
              testId="block-page-editor"
            >
              <PageEditor
                page={currentPage}
                pageCount={note.pageLayout.length}
                pageOrdinal={
                  note.pageLayout.findIndex((p) => p.index === currentPage.index) + 1
                }
                design={currentDesign}
                stickers={currentStickers}
                onChangeDesign={(d) => updatePageDesign(currentPage.index, d)}
                onChangeStickers={(next) => {
                  // Merge: replace stickers on this page; keep others
                  const others = note.stickers.filter((s) => s.pageIndex !== currentPage.index);
                  updateStickers([...others, ...next]);
                }}
                onPrevPage={() => {
                  const idx = note.pageLayout.findIndex((p) => p.index === currentPage.index);
                  if (idx > 0) setSelectedPageIndex(note.pageLayout[idx - 1].index);
                }}
                onNextPage={() => {
                  const idx = note.pageLayout.findIndex((p) => p.index === currentPage.index);
                  if (idx >= 0 && idx < note.pageLayout.length - 1) {
                    setSelectedPageIndex(note.pageLayout[idx + 1].index);
                  }
                }}
                width={320}
                testIdPrefix="page"
              />
              {/* Page picker */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    快速切换页面
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={deleteSelectedPage}
                      disabled={note.pageLayout.length <= 1}
                      className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 text-destructive px-3 py-1 text-xs hover-elevate disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid="button-delete-page"
                      title={
                        note.pageLayout.length <= 1
                          ? "至少需要保留一张页面"
                          : "删除当前选中的页面"
                      }
                    >
                      <Trash2 className="size-3.5" /> 删除页面
                    </button>
                    <button
                      type="button"
                      onClick={addBlankPage}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 text-primary px-3 py-1 text-xs hover-elevate"
                      data-testid="button-add-page"
                    >
                      <Plus className="size-3.5" /> 增加页面
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 scroll-area-hide" data-testid="row-page-picker">
                  {note.pageLayout.map((p, i) => (
                    <button
                      key={p.index}
                      type="button"
                      onClick={() => setSelectedPageIndex(p.index)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs border transition ${
                        p.index === selectedPageIndex
                          ? "bg-foreground text-background border-foreground"
                          : "bg-card border-card-border hover-elevate"
                      }`}
                      data-testid={`button-pick-page-${p.index}`}
                    >
                      {i === 0 ? "封面" : `第 ${i + 1} 张`}
                    </button>
                  ))}
                </div>
              </div>
            </Block>

            {/* Title alt suggestions + copy actions (body & title editing happen inline in preview) */}
            <Block
              title="备选标题"
              testId="block-text-actions"
            >
              <div className="space-y-2">
                {(() => {
                  const original = note.originalTitle;
                  const altList = note.altTitles;
                  const titles: string[] = [];
                  if (original) titles.push(original);
                  altList.forEach((t) => {
                    if (!titles.includes(t)) titles.push(t);
                  });
                  if (titles.length === 0) {
                    return (
                      <p className="text-xs text-muted-foreground" data-testid="text-no-alt-titles">
                        当前没有备选标题。
                      </p>
                    );
                  }
                  return titles.map((text, i) => {
                    const isCurrent = text === note.title;
                    return (
                      <div
                        key={`alt-${i}`}
                        className="text-sm text-muted-foreground flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5"
                        data-testid={`text-alt-title-${i}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider">{`备选 ${i + 1}`}</span>
                          <span>{text}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateNote({ title: text })}
                          disabled={isCurrent}
                          className="text-[11px] rounded-full border border-border px-2 py-0.5 hover-elevate disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid={`button-apply-alt-title-${i}`}
                        >
                          {isCurrent ? "已使用" : "用这个"}
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyBtn
                  active={copied === "title"}
                  onClick={() => copy("title", note.title)}
                  testId="button-copy-title"
                  label="复制标题"
                />
                <CopyBtn
                  active={copied === "body"}
                  onClick={() => copy("body", note.body)}
                  testId="button-copy-body"
                  label="复制正文"
                />
              </div>
            </Block>

            {/* Tags — editable: add/remove chips, live-synced to phone preview */}
            <Block
              title="话题标签"
              testId="block-tags"
              actions={
                <CopyBtn
                  active={copied === "tags"}
                  onClick={() => copy("tags", note.tags.join(" "))}
                  testId="button-copy-tags"
                />
              }
            >
              <div className="flex flex-wrap gap-2" data-testid="row-tags">
                {note.tags.length === 0 && (
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid="text-no-tags"
                  >
                    还没有标签,添加一个试试。
                  </span>
                )}
                {note.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                    data-testid={`tag-chip-${t}`}
                  >
                    <span>{t}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(t)}
                      className="inline-flex items-center justify-center size-4 rounded-full hover:bg-primary/20"
                      aria-label={`删除标签 ${t}`}
                      title={`删除 ${t}`}
                      data-testid={`button-delete-tag-${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="新增话题标签,例如:亲子出行"
                  className="flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
                  data-testid="input-add-tag"
                  maxLength={32}
                />
                <button
                  type="button"
                  onClick={addTag}
                  disabled={normalizeTag(tagDraft) === "" || note.tags.includes(normalizeTag(tagDraft))}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 text-primary px-3 py-1.5 text-xs hover-elevate disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="button-add-tag"
                >
                  <Plus className="size-3.5" /> 添加
                </button>
              </div>
            </Block>

            {/* One-click xhs import (image export now lives inside this block) */}
            <XhsImport
              note={note}
              onDownloadAllZip={() => handleDownloadAll("zip")}
              downloading={exportState === "running"}
              exportError={exportError}
            />

            {/* Comment seeds */}
            <Block
              title="评论区运营建议"
              testId="block-comments"
              actions={
                <CopyBtn
                  active={copied === "comments"}
                  onClick={() => copy("comments", note.commentSeeds.join("\n"))}
                  testId="button-copy-comments"
                />
              }
            >
              <ul className="space-y-2 text-sm">
                {note.commentSeeds.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-card-border bg-card px-3 py-2 flex items-start justify-between gap-3"
                    data-testid={`comment-seed-${i}`}
                  >
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        引导评论 {i + 1}
                      </div>
                      <div className="mt-0.5">{c}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(`comment-${i}`, c)}
                      className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                      data-testid={`button-copy-comment-${i}`}
                    >
                      {copied === `comment-${i}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            </Block>

          </div>
        </div>
      </div>

      {/* Offscreen export frames (positioned off-screen but fully rendered so html-to-image can read them) */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          pointerEvents: "none",
        }}
        data-testid="export-frames-host"
      >
        {exportFrames}
      </div>
    </AppShell>
  );
}

function Block({
  title,
  subtitle,
  children,
  actions,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-card/70 backdrop-blur-sm p-5" data-testid={testId}>
      <div className="flex items-start justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function CopyBtn({
  active,
  onClick,
  testId,
  label,
}: {
  active: boolean;
  onClick: () => void;
  testId: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground rounded-full border border-border px-2 py-1 hover-elevate"
      data-testid={testId}
    >
      {active ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {active ? "已复制" : label || "复制"}
    </button>
  );
}
