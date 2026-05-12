import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { useApp } from "@/lib/app-state";
import { STYLES, STYLE_LIST } from "@/lib/styles";
import { generateNote } from "@/lib/generate";
import type { CoverDesign, GeneratedNote, StickerOverlay } from "@/lib/types";
import { CoverEditor } from "@/components/cover-editor";
import { PhonePreview } from "@/components/phone-preview";
import { XhsImport } from "@/components/xhs-import";
import {
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

export default function ResultPage() {
  const app = useApp();
  const [, navigate] = useLocation();
  const [copied, setCopied] = useState<string | null>(null);

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

  function updateCover(cover: CoverDesign) {
    updateNote({ cover });
  }
  function updateStickers(stickers: StickerOverlay[]) {
    updateNote({ stickers });
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
  }

  function switchStyle(key: keyof typeof STYLES) {
    app.setStyle(key);
    const next = generateNote({ ...app.state, style: key });
    app.setGenerated(next);
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
          {/* LEFT: phone preview with stickers */}
          <div className="lg:col-span-5 space-y-4">
            <PhonePreview
              note={note}
              cover={note.cover}
              stickers={note.stickers}
              onStickersChange={updateStickers}
            />
            <p className="text-xs text-muted-foreground text-center">
              手机端预览 · 可上下滚动 · 贴纸可在画面上拖拽与编辑
            </p>
          </div>

          {/* MIDDLE/RIGHT: cover editor + text editors */}
          <div className="lg:col-span-7 space-y-6">
            <Block title="封面编辑" testId="block-cover-editor" subtitle="拖拽图层移动 · 右下角缩放 · 中心十字裁切 · 可替换/新增/删除">
              <CoverEditor
                design={note.cover}
                onChange={updateCover}
                width={320}
                testIdPrefix="cover"
              />
            </Block>

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

            {/* One-click xhs import */}
            <XhsImport note={note} />

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
