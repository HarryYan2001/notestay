import { useState } from "react";
import type { GeneratedNote } from "@/lib/types";
import { Check, ExternalLink, Info, AlertTriangle, Download, Loader2 } from "lucide-react";

const XHS_CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish?source=web";

interface Props {
  note: GeneratedNote;
  onDownloadAllZip?: () => void | Promise<void>;
  downloading?: boolean;
  exportError?: string | null;
}

export function XhsImport({ note, onDownloadAllZip, downloading, exportError }: Props) {
  const [status, setStatus] = useState<"idle" | "copying" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);

  function buildClipboardPayload(): string {
    const tagLine = note.tags
      .map((t) => (t.startsWith("#") ? t : `#${t}`))
      .join(" ");
    return [
      note.title,
      "",
      note.body.trim(),
      "",
      tagLine,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function copyPayload(payload: string): Promise<boolean> {
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        copied = true;
      } else {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        }
        document.body.removeChild(ta);
      }
    } catch (e: unknown) {
      copied = false;
      setError(e instanceof Error ? e.message : "复制失败");
    }
    return copied;
  }

  async function handleOneClick() {
    setError(null);
    setShowManualCopy(false);
    setStatus("copying");
    const payload = buildClipboardPayload();

    let opened = false;
    try {
      const w = window.open(XHS_CREATOR_URL, "_blank", "noopener,noreferrer");
      opened = Boolean(w);
    } catch {
      opened = false;
    }

    const copied = await copyPayload(payload);
    if (!copied) {
      setStatus("error");
      setShowManualCopy(true);
      setError(
        opened
          ? "已尝试打开小红书发布页,但浏览器没有允许自动复制。请使用下方文本框手动复制后粘贴。"
          : "浏览器拦截了新标签页,也没有允许自动复制。请使用下方文本框手动复制,并自行打开小红书发布页。",
      );
      return;
    }

    if (!opened) {
      setError("文案已复制,但浏览器拦截了新标签页。请手动打开小红书创作中心粘贴。");
    }
    setStatus("done");
  }

  return (
    <section
      className="rounded-2xl border border-card-border bg-card/70 backdrop-blur-sm p-5 space-y-3"
      data-testid="block-xhs-import"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-wide">一键导入小红书</h3>
          <p className="text-xs text-muted-foreground mt-1">
            两步走:
            <strong>① 先「导出全部图片」</strong>(含贴纸,会保存到本地下载目录) ·
            <strong>② 再「一键导入小红书」</strong>(自动复制文案 + 打开创作中心),
            到达后只需 <strong>Ctrl/Cmd + V</strong> 粘贴文案,并在创作中心上传刚刚下载的图片即可。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {onDownloadAllZip && (
          <button
            type="button"
            onClick={() => onDownloadAllZip?.()}
            disabled={downloading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm font-medium disabled:opacity-60"
            data-testid="button-xhs-download-images"
          >
            {downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {downloading ? "正在导出图片…" : "一键导出全部图片(含贴纸)"}
          </button>
        )}
        <button
          type="button"
          onClick={handleOneClick}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#fe2c55] text-white text-sm font-medium hover:opacity-95"
          data-testid="button-xhs-oneclick"
        >
          {status === "done" ? (
            <Check className="size-4" />
          ) : (
            <ExternalLink className="size-4" />
          )}
          {status === "done" ? "已复制 · 已打开小红书" : "一键导入小红书"}
        </button>
      </div>

      {status === "done" && !error && (
        <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300" data-testid="xhs-status-ok">
          <Check className="size-4 mt-0.5 shrink-0" />
          已复制标题、正文和标签到剪贴板。请到小红书创作中心粘贴并上传刚导出的图片。
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300" data-testid="xhs-status-error">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {exportError && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300" data-testid="xhs-export-error">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          {exportError}
        </div>
      )}

      {showManualCopy && (
        <div className="space-y-2" data-testid="xhs-manual-copy-block">
          <p className="text-xs font-medium text-foreground">手动复制内容</p>
          <textarea
            readOnly
            value={buildClipboardPayload()}
            className="min-h-40 w-full rounded-xl border border-border bg-background p-3 text-xs leading-relaxed text-foreground"
            data-testid="textarea-xhs-manual-copy"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground" data-testid="xhs-limit-note">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        受浏览器同源策略与小红书登录态保护,网页版无法直接代你完成填表与发布。
        我们的导入方案是:本地复制全部文案 + 自动打开小红书创作中心,
        其余步骤(粘贴文案、上传图片、点击发布)在小红书页面内完成,信息不会被本应用上传。
        如需真正全自动,请使用支持 Manifest V3 的浏览器扩展(参考素材见 page-bridge / xhs 脚本)。
      </div>
    </section>
  );
}
