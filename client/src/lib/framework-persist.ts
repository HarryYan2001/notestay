import type { FrameworkField } from "./types";

// Project constraint: no localStorage / sessionStorage / IndexedDB / cookies.
// To make a user's custom framework survive a page refresh on a static
// (GitHub Pages) deploy, we encode state into the URL search string and
// update it whenever the framework changes. The hash portion is reserved
// for wouter's hash router; we keep our state in the regular `?...` search
// portion so routing is unaffected.
//
// Two params are written:
//   ?fw=...  — the user's currently-active framework (id/label/value list)
//   ?tpl=... — the user's saved custom framework templates (name + fields)
//
// Each is JSON → UTF-8 bytes → URL-safe base64. Decoding is best-effort:
// corrupt payloads are silently ignored and callers fall back to defaults.

const PARAM_CURRENT = "fw";
const PARAM_TEMPLATES = "tpl";

interface PersistShape {
  v: 1;
  // Slim representation: id, label, value. Order is preserved.
  f: { i: string; l: string; v: string }[];
}

export interface SavedFrameworkTemplate {
  // Stable id (e.g. `tpl_<timestamp>`). Used for delete/apply.
  id: string;
  // User-provided template name. Required, trimmed, non-empty.
  name: string;
  // Field shape — labels + initial values the user wants to keep. When the
  // template is applied, we reuse the labels but assign fresh per-instance
  // ids so each application doesn't collide with the existing framework.
  fields: { label: string; value: string }[];
}

interface TemplatesShape {
  v: 1;
  t: { i: string; n: string; f: { l: string; v: string }[] }[];
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

function utf8ToB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return toUrlSafeBase64(btoa(bin));
}

function b64UrlToUtf8(s: string): string {
  const padded = fromUrlSafeBase64(s);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeFrameworkToParam(fields: FrameworkField[]): string {
  const payload: PersistShape = {
    v: 1,
    f: fields.map((f) => ({ i: f.id, l: f.label, v: f.value })),
  };
  return utf8ToB64Url(JSON.stringify(payload));
}

export function decodeFrameworkFromParam(raw: string): FrameworkField[] | null {
  try {
    const data = JSON.parse(b64UrlToUtf8(raw)) as PersistShape;
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

export function encodeTemplatesToParam(templates: SavedFrameworkTemplate[]): string {
  const payload: TemplatesShape = {
    v: 1,
    t: templates.map((t) => ({
      i: t.id,
      n: t.name,
      f: t.fields.map((f) => ({ l: f.label, v: f.value })),
    })),
  };
  return utf8ToB64Url(JSON.stringify(payload));
}

export function decodeTemplatesFromParam(raw: string): SavedFrameworkTemplate[] | null {
  try {
    const data = JSON.parse(b64UrlToUtf8(raw)) as TemplatesShape;
    if (!data || data.v !== 1 || !Array.isArray(data.t)) return null;
    return data.t
      .filter((row) => row && typeof row.n === "string" && Array.isArray(row.f))
      .map((row, idx) => ({
        id: typeof row.i === "string" && row.i ? row.i : `tpl_persisted_${idx}`,
        name: row.n,
        fields: row.f
          .filter((cell) => cell && typeof cell.l === "string")
          .map((cell) => ({
            label: cell.l,
            value: typeof cell.v === "string" ? cell.v : "",
          })),
      }));
  } catch {
    return null;
  }
}

export function readFrameworkFromUrl(): FrameworkField[] | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get(PARAM_CURRENT);
  if (!raw) return null;
  return decodeFrameworkFromParam(raw);
}

export function readTemplatesFromUrl(): SavedFrameworkTemplate[] | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get(PARAM_TEMPLATES);
  if (!raw) return null;
  return decodeTemplatesFromParam(raw);
}

function writeParam(name: string, value: string | null) {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  if (value === null) sp.delete(name);
  else sp.set(name, value);
  const search = sp.toString();
  const next =
    window.location.pathname +
    (search ? `?${search}` : "") +
    window.location.hash;
  // replaceState avoids spamming the browser back stack on every keystroke.
  window.history.replaceState(window.history.state, "", next);
}

export function writeFrameworkToUrl(fields: FrameworkField[]): void {
  writeParam(PARAM_CURRENT, fields.length === 0 ? null : encodeFrameworkToParam(fields));
}

export function writeTemplatesToUrl(templates: SavedFrameworkTemplate[]): void {
  writeParam(PARAM_TEMPLATES, templates.length === 0 ? null : encodeTemplatesToParam(templates));
}

// Apply a saved template by minting fresh per-field ids so the resulting
// framework can coexist with whatever was there before without colliding.
export function instantiateTemplate(template: SavedFrameworkTemplate): FrameworkField[] {
  const stamp = Date.now();
  return template.fields.map((f, idx) => ({
    id: `f_tpl_${template.id}_${stamp}_${idx}`,
    label: f.label,
    value: f.value,
  }));
}
