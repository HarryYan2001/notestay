import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { useApp } from "@/lib/app-state";
import { STYLES, STYLE_LIST } from "@/lib/styles";
import { generateNote } from "@/lib/generate";
import type { GeneratedNote, PageDesign, StickerOverlay } from "@/lib/types";
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
  Download,
  Loader2,
} from "lucide-react";

const EXPORT_WIDTH = 720; // px (3:4 aspect → 720x960)

export default function ResultPage() {
  const app = useApp();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [exportState, setExportState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [exportError, setExportError] = useState<string | null>(null);
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

  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
    });
  }

  function regenerate() {
    const next = generateNote(app.state);
    app.setGenerated(next);
    setSelectedPageIndex(0);
  }

  function switchStyle(key: keyof typeof STYLES) {
    app.setStyle(key);
    const next = generateNote({ ...app.state, style: key });
    app.setGenerated(next);
    setSelectedPageIndex(0);
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-95"
            >
              <RefreshCw className="size-4" /> 重新生成
            </button>
          </div>
        </div>

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
            </div>
          </div>

          {/* RIGHT: page editor + text editors */}
          <div className="lg:col-span-7 space-y-6">
            <Block
              title="页面编辑"
              testId="block-page-editor"
              subtitle="选中预览中的某一页即可在此编辑该页的图片 / 文字 / 贴纸 · 拖拽移动、圆点旋转、双击图片调整裁切"
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
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                  快速切换页面
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
              title="标题备选 & 文案复制"
              testId="block-text-actions"
              subtitle="标题与正文请直接在左侧手机预览中编辑;此处提供备选标题与一键复制。"
            >
              <div className="space-y-2">
                {note.altTitles.map((t, i) => (
                  <div
                    key={i}
                    className="text-sm text-muted-foreground flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5"
                    data-testid={`text-alt-title-${i}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider">备选 {i + 1}</span>
                      <span>{t}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateNote({ title: t })}
                      className="text-[11px] rounded-full border border-border px-2 py-0.5 hover-elevate"
                      data-testid={`button-apply-alt-title-${i}`}
                    >
                      用这个
                    </button>
                  </div>
                ))}
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

            {/* Tags */}
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
                {note.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Block>

            {/* Download all pages */}
            <Block
              title="下载编辑后的图片"
              testId="block-download-pages"
              subtitle="一键将所有页面(含贴纸)导出为 PNG,可整包下载或逐张下载到本地,再上传到小红书。"
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadAll("zip")}
                  disabled={exportState === "running"}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium disabled:opacity-60"
                  data-testid="button-download-all-zip"
                >
                  {exportState === "running" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : exportState === "done" ? (
                    <Check className="size-4" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {exportState === "running"
                    ? "正在打包…"
                    : exportState === "done"
                    ? "已开始下载"
                    : "一键打包下载(ZIP)"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDownloadAll("individual")}
                  disabled={exportState === "running"}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm hover-elevate disabled:opacity-60"
                  data-testid="button-download-all-individual"
                >
                  <Download className="size-4" /> 逐张下载 PNG
                </button>
              </div>
              {exportError && (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-300" data-testid="export-error">
                  <AlertTriangle className="size-3.5 inline mr-1" />
                  {exportError}
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                由于浏览器安全策略,无法直接选择文件夹保存。我们会调用浏览器的下载机制,
                文件会进入你的「下载」目录(可在浏览器设置中修改默认下载位置)。
              </p>
            </Block>

            {/* One-click xhs import */}
            <XhsImport
              note={note}
              onDownloadAllZip={() => handleDownloadAll("zip")}
              downloading={exportState === "running"}
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

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => copy("full", buildFullCopy(note))}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-95"
                data-testid="button-copy-all"
              >
                {copied === "full" ? <Check className="size-4" /> : <Copy className="size-4" />}
                一键复制全部内容
              </button>
              <button
                type="button"
                onClick={regenerate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-sm"
                data-testid="button-regenerate-bottom"
              >
                <Sparkles className="size-4" /> 重新生成本风格
              </button>
            </div>
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

function buildFullCopy(n: GeneratedNote) {
  return [
    n.title,
    "",
    n.body,
    "",
    n.tags.join(" "),
    "",
    "---",
    "评论引导:",
    ...n.commentSeeds,
  ].join("\n");
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
