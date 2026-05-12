import type { FrameworkField } from "./types";

// Project constraint: no localStorage / sessionStorage / IndexedDB / cookies.
// To make a user's custom framework survive a page refresh on a static
// (GitHub Pages) deploy, we encode it into the URL search string and update
// the URL whenever the framework changes. The hash portion is reserved for
// wouter's hash router; we keep our state in the regular `?...` search
// portion so routing is unaffected.
//
// We encode as JSON → URI-encoded → base64 (URL-safe) to keep the URL short
// and tolerant of CJK characters. Decoding is best-effort: anything corrupt
// is silently ignored and the caller falls back to defaults.

const PARAM = "fw";

interface PersistShape {
  v: 1;
  // Slim representation: id, label, value. Order is preserved.
  f: { i: string; l: string; v: string }[];
}

function toUrlSafeBase64(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromUrlSafeBase64(s: string): string {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  // Restore base64 padding so atob() doesn't throw on lengths not divisible by 4.
  while (t.length % 4) t += "=";
  return t;
}

export function encodeFrameworkToParam(fields: FrameworkField[]): string {
  const payload: PersistShape = {
    v: 1,
    f: fields.map((f) => ({ i: f.id, l: f.label, v: f.value })),
  };
  const json = JSON.stringify(payload);
  // encodeURIComponent then btoa — using TextEncoder + btoa is more compact
  // than escape() (deprecated) and handles CJK correctly.
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return toUrlSafeBase64(btoa(bin));
}

export function decodeFrameworkFromParam(raw: string): FrameworkField[] | null {
  try {
    const padded = fromUrlSafeBase64(raw);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json) as PersistShape;
    if (!data || data.v !== 1 || !Array.isArray(data.f)) return null;
    return data.f
      .filter((row) => row && typeof row.l === "string")
      .map((row, idx) => ({
        id: typeof row.i === "string" && row.i ? row.i : `f_persisted_${idx}`,
        label: row.l,
        value: typeof row.v === "string" ? row.v : "",
      }));
  } catch {
    return null;
  }
}

export function readFrameworkFromUrl(): FrameworkField[] | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get(PARAM);
  if (!raw) return null;
  return decodeFrameworkFromParam(raw);
}

export function writeFrameworkToUrl(fields: FrameworkField[]): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  // Only write if there's at least one non-default-looking entry. We still
  // write empty-value frameworks because the user may have customised the
  // labels and we want those to persist even before they type values.
  if (fields.length === 0) {
    sp.delete(PARAM);
  } else {
    sp.set(PARAM, encodeFrameworkToParam(fields));
  }
  const search = sp.toString();
  const next =
    window.location.pathname +
    (search ? `?${search}` : "") +
    window.location.hash;
  // replaceState avoids spamming the browser back stack on every keystroke.
  window.history.replaceState(window.history.state, "", next);
}
