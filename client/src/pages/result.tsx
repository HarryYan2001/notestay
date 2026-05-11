import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { useApp } from "@/lib/app-state";
import { STYLES, STYLE_LIST } from "@/lib/styles";
import { generateNote } from "@/lib/generate";
import type { GeneratedNote } from "@/lib/types";
import {
  Copy,
  Check,
  RefreshCw,
  Heart,
  MessageCircle,
  Bookmark,
  Share2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

export default function ResultPage() {
  const app = useApp();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const imageMap = useImageMap();

  // If no generated note yet, redirect back to create
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
    app.setGenerated({ ...note, ...patch });
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
    setPageIdx(0);
  }

  function switchStyle(key: keyof typeof STYLES) {
    app.setStyle(key);
    const next = generateNote({ ...app.state, style: key });
    app.setGenerated(next);
    setPageIdx(0);
  }

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

        <div className="mt-8 grid lg:grid-cols-12 gap-8">
          {/* LEFT: phone preview */}
          <div className="lg:col-span-5">
            <PhonePreview
              note={note}
              pageIdx={pageIdx}
              onPrev={() => setPageIdx((i) => Math.max(0, i - 1))}
              onNext={() => setPageIdx((i) => Math.min(note.pageLayout.length - 1, i + 1))}
              imageMap={imageMap}
            />
            <p className="mt-3 text-xs text-muted-foreground text-center">
              手机端预览 · 模拟小红书笔记翻页,所见即所得
            </p>
          </div>

          {/* RIGHT: content blocks */}
          <div className="lg:col-span-7 space-y-6">
            {/* Title */}
            <Block
              title="标题"
              testId="block-title"
              actions={
                <CopyBtn
                  active={copied === "title"}
                  onClick={() => copy("title", note.title)}
                  testId="button-copy-title"
                />
              }
            >
              <textarea
                value={note.title}
                onChange={(e) => updateNote({ title: e.target.value })}
                rows={2}
                className="w-full rounded-xl border border-input bg-background p-3 text-xl md:text-2xl font-bold leading-snug focus:border-primary focus:outline-none resize-none"
                data-testid="input-edit-title"
                aria-label="编辑标题"
              />
              <div className="mt-3 space-y-1">
                {note.altTitles.map((t, i) => (
                  <div
                    key={i}
                    className="text-sm text-muted-foreground flex items-center gap-2"
                    data-testid={`text-alt-title-${i}`}
                  >
                    <span className="text-[10px] uppercase tracking-wider">备选 {i + 1}</span>
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </Block>

            {/* Body */}
            <Block
              title="正文"
              testId="block-body"
              actions={
                <CopyBtn
                  active={copied === "body"}
                  onClick={() => copy("body", note.body)}
                  testId="button-copy-body"
                />
              }
            >
              <textarea
                value={note.body}
                onChange={(e) => updateNote({ body: e.target.value })}
                rows={14}
                className="w-full rounded-xl border border-input bg-background p-3 text-sm leading-relaxed focus:border-primary focus:outline-none resize-y"
                data-testid="input-edit-body"
                aria-label="编辑正文"
              />
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

            {/* Sticker copy */}
            <Block title="贴纸文案 / 大字" testId="block-stickers">
              <div className="grid sm:grid-cols-2 gap-2">
                {note.stickerCopy.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-card-border bg-card px-3 py-2 text-sm flex items-center justify-between gap-2"
                    data-testid={`sticker-${i}`}
                  >
                    <span>{s}</span>
                    <button
                      type="button"
                      onClick={() => copy(`sticker-${i}`, s)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      data-testid={`button-copy-sticker-${i}`}
                      aria-label="复制"
                    >
                      {copied === `sticker-${i}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            </Block>

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
    </AppShell>
  );
}

function useImageMap() {
  const app = useApp();
  return useMemo(() => {
    const map: Record<string, string> = {};
    app.state.images.forEach((i) => (map[i.id] = i.url));
    return map;
  }, [app.state.images]);
}

function roleLabel(r: string) {
  if (r === "cover") return "封面页";
  if (r === "verdict") return "总结页";
  return "内页";
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
    "贴纸文案:",
    ...n.stickerCopy,
    "",
    "评论引导:",
    ...n.commentSeeds,
  ].join("\n");
}

function Block({
  title,
  children,
  actions,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl border border-card-border bg-card/70 backdrop-blur-sm p-5" data-testid={testId}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold tracking-wide">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function CopyBtn({ active, onClick, testId }: { active: boolean; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      data-testid={testId}
    >
      {active ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {active ? "已复制" : "复制"}
    </button>
  );
}

function PhonePreview({
  note,
  pageIdx,
  onPrev,
  onNext,
  imageMap,
}: {
  note: GeneratedNote;
  pageIdx: number;
  onPrev: () => void;
  onNext: () => void;
  imageMap: Record<string, string>;
}) {
  const current = note.pageLayout[pageIdx] ?? note.pageLayout[0];
  const style = STYLES[note.styleKey];
  return (
    <div className="mx-auto w-[300px] md:w-[320px]" data-testid="phone-preview">
      <div className="relative rounded-[2.6rem] bg-foreground/90 dark:bg-black p-2 shadow-2xl ring-1 ring-black/10">
        <div className="rounded-[2.2rem] overflow-hidden bg-background">
          {/* status bar */}
          <div className="px-5 pt-2 pb-1 flex items-center justify-between text-[10px] text-foreground/80">
            <span>9:41</span>
            <span>● ● ●</span>
          </div>

          {/* image / cover area */}
          <div className="relative aspect-[3/4]">
            {current.role === "cover" ? (
              <CoverArt note={note} styleName={style.english} current={current} imageUrls={Object.values(imageMap)} />
            ) : current.imageId && imageMap[current.imageId] ? (
              <img src={imageMap[current.imageId]} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <div className="absolute inset-0" style={{ background: current.gradient }} />
            )}
            {current.role !== "cover" && <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" />}

            {/* prev / next dots */}
            <div className="absolute inset-x-0 bottom-1 flex justify-center gap-1">
              {note.pageLayout.map((p) => (
                <span
                  key={p.index}
                  className={`size-1.5 rounded-full ${
                    p.index === pageIdx ? "bg-white" : "bg-white/40"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* note body summary */}
          <div className="px-4 py-3 text-foreground">
            <div className="text-[13px] font-bold leading-snug line-clamp-2" data-testid="text-preview-title">
              {note.title}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-3" data-testid="text-preview-body">
              {note.body.slice(0, 160)}…
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.slice(0, 4).map((t) => (
                <span key={t} className="text-[10px] text-primary">{t}</span>
              ))}
            </div>
          </div>

          {/* engagement bar */}
          <div className="px-4 py-2 border-t border-border/60 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Heart className="size-3.5" /> 12.3k</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" /> 482</span>
            <span className="inline-flex items-center gap-1"><Bookmark className="size-3.5" /> 3.1k</span>
            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5" /> 分享</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="size-9 inline-flex items-center justify-center rounded-full border border-border bg-card hover-elevate disabled:opacity-40"
          disabled={pageIdx === 0}
          data-testid="button-preview-prev"
          aria-label="上一页"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="text-xs text-muted-foreground" data-testid="text-preview-pageinfo">
          {pageIdx + 1} / {note.pageLayout.length}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="size-9 inline-flex items-center justify-center rounded-full border border-border bg-card hover-elevate disabled:opacity-40"
          disabled={pageIdx === note.pageLayout.length - 1}
          data-testid="button-preview-next"
          aria-label="下一页"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function CoverArt({
  note,
  styleName,
  current,
  imageUrls,
}: {
  note: GeneratedNote;
  styleName: string;
  current: GeneratedNote["pageLayout"][number];
  imageUrls: string[];
}) {
  const titleMain = note.title.split("｜")[0] || note.coverHeadline;
  const [primary, secondary, tertiary] = imageUrls;
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: current.gradient }} data-testid="cover-art">
      <div className="absolute inset-0 bg-[#f5d8c8]" />
      <div className="absolute inset-2 rounded-[1.4rem] bg-[#b7c7dd] shadow-inner overflow-hidden">
        {primary ? (
          <img src={primary} alt="" className="absolute inset-0 size-full object-cover scale-105" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,#e9f2ff_0,#88a9d2_38%,#4d6f9a_100%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/35" />
        <div className="absolute left-3 top-3 flex gap-1">
          <span className="size-2 rounded-full bg-yellow-300 shadow" />
          <span className="size-2 rounded-full bg-orange-400 shadow" />
        </div>
        <div className="absolute right-3 top-3 rounded-full bg-white/30 px-2 py-0.5 text-[9px] font-bold text-white backdrop-blur">
          NoteStay
        </div>
        <div className="absolute inset-x-4 top-10 text-center">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/85">{styleName}</div>
          <div className="mt-2 whitespace-pre-line text-[30px] font-black leading-[0.95] tracking-tight text-white drop-shadow-[0_3px_8px_rgba(0,0,0,.35)]">
            {titleMain}
          </div>
        </div>
        <div className="absolute inset-x-4 bottom-16 grid grid-cols-2 gap-2">
          <div className="aspect-[3/4] rounded-xl bg-white/25 p-1 backdrop-blur shadow-lg">
            {secondary ? (
              <img src={secondary} alt="" className="size-full rounded-lg object-cover" />
            ) : (
              <div className="size-full rounded-lg bg-white/45" />
            )}
          </div>
          <div className="aspect-[3/4] rounded-xl bg-white/25 p-1 backdrop-blur shadow-lg translate-y-4">
            {tertiary ? (
              <img src={tertiary} alt="" className="size-full rounded-lg object-cover" />
            ) : (
              <div className="size-full rounded-lg bg-white/35" />
            )}
          </div>
        </div>
        <div className="absolute inset-x-4 bottom-5 flex items-center justify-between rounded-2xl bg-white/25 px-3 py-2 text-[10px] font-semibold text-white backdrop-blur">
          <span>{note.coverSubline}</span>
          <span>收藏攻略</span>
        </div>
      </div>
    </div>
  );
}
