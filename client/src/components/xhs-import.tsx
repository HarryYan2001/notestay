import { useEffect, useRef, useState } from "react";
import type { GeneratedNote } from "@/lib/types";
import {
  Check,
  ExternalLink,
  Info,
  AlertTriangle,
  Download,
  Loader2,
  Wrench,
  Copy,
  RefreshCw,
  X,
} from "lucide-react";

const XHS_CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish?source=web";
// Alternate landing URLs we can hand the user when the primary creator URL
// is blocked, hijacked, or otherwise unreachable. These are all official
// Xiaohongshu publish/upload entrypoints.
const XHS_FALLBACK_URLS: { label: string; url: string }[] = [
  { label: "创作中心 · 发布", url: XHS_CREATOR_URL },
  { label: "创作服务平台首页", url: "https://creator.xiaohongshu.com/" },
  { label: "小红书首页(从顶部「发布笔记」进入)", url: "https://www.xiaohongshu.com/" },
];

type ImportStatus =
  | "idle"
  | "copying"
  | "done"
  | "popup_blocked"
  | "copy_blocked"
  | "nav_unreachable"
  | "error";

interface Props {
  note: GeneratedNote;
  onDownloadAllZip?: () => void | Promise<void>;
  downloading?: boolean;
  exportError?: string | null;
}

export function XhsImport({ note, onDownloadAllZip, downloading, exportError }: Props) {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const openedWindowRef = useRef<Window | null>(null);

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

  // Verify that the popup we opened is still live shortly after spawning. Some
  // browsers / extensions / corp proxies allow window.open() to succeed but
  // then close or hijack the new tab. If after ~1.2s the window is gone
  // without our intervention, treat this as nav_unreachable and surface the
  // repair panel so the user has a manual fallback.
  function watchPopupHealth(w: Window | null) {
    if (!w) return;
    openedWindowRef.current = w;
    let elapsed = 0;
    const interval = window.setInterval(() => {
      elapsed += 400;
      if (!openedWindowRef.current) {
        window.clearInterval(interval);
        return;
      }
      const dead = openedWindowRef.current.closed;
      if (dead) {
        window.clearInterval(interval);
        // If the user closed it intentionally after status="done", leave
        // status alone. If it dies within the first 1.2s, treat as unreachable.
        if (elapsed <= 1200 && status !== "done") {
          setStatus("nav_unreachable");
          setRepairOpen(true);
        }
        openedWindowRef.current = null;
      }
      if (elapsed >= 1600) {
        window.clearInterval(interval);
      }
    }, 400);
  }

  useEffect(() => {
    return () => {
      openedWindowRef.current = null;
    };
  }, []);

  async function handleOneClick() {
    setError(null);
    setRepairOpen(false);
    setCopyOk(false);
    setStatus("copying");
    const payload = buildClipboardPayload();

    let opened = false;
    let popup: Window | null = null;
    try {
      popup = window.open(XHS_CREATOR_URL, "_blank", "noopener,noreferrer");
      opened = Boolean(popup);
    } catch {
      opened = false;
    }

    const copied = await copyPayload(payload);
    setCopyOk(copied);

    if (!opened && !copied) {
      setStatus("error");
      setRepairOpen(true);
      setError("浏览器同时拦截了新标签页和自动复制。请使用下方修复面板手动操作。");
      return;
    }
    if (!opened) {
      setStatus("popup_blocked");
      setRepairOpen(true);
      setError("文案已复制,但浏览器拦截了新标签页。请使用下方修复面板手动打开小红书发布页。");
      return;
    }
    if (!copied) {
      setStatus("copy_blocked");
      setRepairOpen(true);
      setError("已尝试打开小红书发布页,但浏览器未允许自动复制。请使用下方修复面板手动复制文案。");
      watchPopupHealth(popup);
      return;
    }
    setStatus("done");
    watchPopupHealth(popup);
  }

  async function retryCopy() {
    setError(null);
    const ok = await copyPayload(buildClipboardPayload());
    setCopyOk(ok);
    if (ok && (status === "copy_blocked" || status === "popup_blocked")) {
      // Promote to a partial success — clipboard works, user may still need
      // to open the tab themselves.
      setError(null);
    }
  }

  function manualOpen(url: string) {
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) {
        if (copyOk) setStatus("done");
        watchPopupHealth(w);
      } else {
        setError("再次尝试打开新标签页仍被拦截。请复制下方链接并自行粘贴到地址栏。");
      }
    } catch {
      setError("浏览器禁止本页打开新窗口,请复制下方链接到地址栏访问。");
    }
  }

  const showRepair = repairOpen || status === "error" || status === "nav_unreachable" || status === "popup_blocked" || status === "copy_blocked";

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
        <button
          type="button"
          onClick={() => setRepairOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-border bg-card text-sm hover-elevate"
          data-testid="button-xhs-toggle-repair"
          aria-expanded={repairOpen}
        >
          <Wrench className="size-4" /> {repairOpen ? "收起跳转修复" : "跳转修复"}
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

      {showRepair && (
        <div
          className="rounded-xl border border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-4 space-y-3"
          data-testid="xhs-repair-panel"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-200 inline-flex items-center gap-1.5">
              <Wrench className="size-3.5" /> 跳转修复 · 自助恢复导入
            </div>
            <button
              type="button"
              onClick={() => setRepairOpen(false)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] hover-elevate"
              data-testid="button-xhs-repair-close"
            >
              <X className="size-3" /> 收起
            </button>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-200/90 leading-relaxed">
            如果一键导入没有成功,可能是浏览器拦截了弹窗、扩展屏蔽了跳转、或者公司网络无法访问小红书。
            下面提供完整的备用方案,任选一项即可继续完成发布:
          </p>

          <div className="space-y-1.5" data-testid="xhs-repair-step-copy">
            <div className="text-[11px] font-semibold text-foreground">① 手动复制文案</div>
            <textarea
              readOnly
              value={buildClipboardPayload()}
              className="min-h-32 w-full rounded-xl border border-border bg-background p-3 text-xs leading-relaxed text-foreground"
              data-testid="textarea-xhs-manual-copy"
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={retryCopy}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate"
                data-testid="button-xhs-retry-copy"
              >
                <Copy className="size-3" /> 再次尝试自动复制
              </button>
              {copyOk && (
                <span className="text-[11px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                  <Check className="size-3" /> 已复制到剪贴板
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1.5" data-testid="xhs-repair-step-open">
            <div className="text-[11px] font-semibold text-foreground">② 选择一个备用入口手动打开</div>
            <div className="flex flex-wrap gap-2">
              {XHS_FALLBACK_URLS.map((u) => (
                <button
                  key={u.url}
                  type="button"
                  onClick={() => manualOpen(u.url)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate"
                  data-testid={`button-xhs-open-${u.label}`}
                  title={u.url}
                >
                  <ExternalLink className="size-3" /> {u.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleOneClick}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate"
                data-testid="button-xhs-retry-oneclick"
              >
                <RefreshCw className="size-3" /> 重新一键导入
              </button>
            </div>
            <div className="text-[10px] text-muted-foreground leading-relaxed">
              提示:也可以复制以下任一链接,粘贴到浏览器地址栏后回车:
            </div>
            <ul className="text-[10px] text-muted-foreground space-y-0.5 break-all">
              {XHS_FALLBACK_URLS.map((u) => (
                <li key={u.url} data-testid={`xhs-fallback-url-${u.label}`}>
                  · {u.url}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5" data-testid="xhs-repair-step-download">
            <div className="text-[11px] font-semibold text-foreground">③ 仍打不开?先把图片下载到本地备用</div>
            {onDownloadAllZip && (
              <button
                type="button"
                onClick={() => onDownloadAllZip?.()}
                disabled={downloading}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate disabled:opacity-60"
                data-testid="button-xhs-repair-download"
              >
                {downloading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Download className="size-3" />
                )}
                {downloading ? "正在导出图片…" : "立即导出编辑好的图片"}
              </button>
            )}
            <p className="text-[10px] text-muted-foreground">
              把图片先保存下来,稍后用小红书 App 或换一台设备登录后,再粘贴上方文案、上传图片即可。
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground" data-testid="xhs-limit-note">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        受浏览器同源策略与小红书登录态保护,网页版无法直接代你完成填表与发布。
        我们的导入方案是:本地复制全部文案 + 自动打开小红书创作中心,
        其余步骤(粘贴文案、上传图片、点击发布)在小红书页面内完成,信息不会被本应用上传。
        如新标签页或自动复制被拦截,点击「跳转修复」按钮可获得手动备用流程。
      </div>
    </section>
  );
}
