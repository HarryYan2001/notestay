import { useState } from "react";
import type { GeneratedNote } from "@/lib/types";
import { Check, ExternalLink, Copy, Info, AlertTriangle } from "lucide-react";

const XHS_CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish?source=web";

interface Props {
  note: GeneratedNote;
}

export function XhsImport({ note }: Props) {
  const [status, setStatus] = useState<"idle" | "copying" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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

  async function handleOneClick() {
    setError(null);
    setStatus("copying");
    const payload = buildClipboardPayload();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload);
        copied = true;
      } else {
        // legacy fallback
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
    if (!copied) {
      setStatus("error");
      return;
    }
    // Try opening the Xiaohongshu publish page in a new tab
    try {
      const w = window.open(XHS_CREATOR_URL, "_blank", "noopener,noreferrer");
      if (!w) {
        // popup blocked — fallback to current tab navigation guarded
        setError("浏览器拦截了新标签页,请手动点击下方链接前往小红书发布页。");
      }
    } catch {
      // ignore — link button below remains
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
            点击下方按钮:自动复制完整文案到剪贴板,并在新标签页打开小红书创作中心,
            到达后只需 <strong>Ctrl/Cmd + V</strong> 即可粘贴标题与正文。
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
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
        <a
          href={XHS_CREATOR_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm hover-elevate"
          data-testid="link-xhs-creator"
        >
          <ExternalLink className="size-4" /> 仅打开小红书发布页
        </a>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildClipboardPayload());
              setStatus("done");
            } catch {
              setStatus("error");
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm hover-elevate"
          data-testid="button-xhs-copy"
        >
          <Copy className="size-4" /> 仅复制文案
        </button>
      </div>

      {status === "done" && !error && (
        <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300" data-testid="xhs-status-ok">
          <Check className="size-4 mt-0.5 shrink-0" />
          已复制标题、正文和标签到剪贴板。请到小红书创作中心粘贴。
          图片请使用「图片上传」页中的实拍照片(或封面下方下载按钮导出封面)再上传到小红书。
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300" data-testid="xhs-status-error">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          {error}
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
