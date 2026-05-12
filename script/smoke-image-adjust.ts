// Smoke test for image-adjustment presentation.
// Guards against re-introducing the amber outline / badge UI that PR #16
// added and that the user asked to revert, while keeping the exit mechanisms
// (stage click, document-level outside click, settings panel toggle) intact.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const editorPath = join(
  import.meta.dirname,
  "..",
  "client",
  "src",
  "components",
  "page-editor.tsx",
);
const src = readFileSync(editorPath, "utf-8");

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

// No amber outline / glow / badge introduced by PR #16.
assert(!src.includes("#f59e0b"), "amber outline color must not be present");
assert(!src.includes("bg-amber-500"), "amber badge background must not be present");
assert(
  !src.includes("adjusting-badge"),
  "adjusting-badge testid must not be present",
);

// The previous-version centered hint must still be there while editing.
assert(
  src.includes("拖动 / 滚轮缩放"),
  "centered hint '拖动 / 滚轮缩放' must remain",
);
assert(
  src.includes("bg-black/55"),
  "previous-version hint background bg-black/55 must remain",
);

// Exit affordances must remain.
assert(
  src.includes('setEditingImageId(null)'),
  "stage pointerdown must still clear editingImageId",
);
assert(
  src.includes('document.addEventListener("pointerdown"'),
  "document-level outside-click handler must remain for exit-on-outside",
);
assert(
  src.includes("退出调整图片"),
  "settings panel '退出调整图片' Chinese exit toggle must remain",
);

// Settings-panel exit button still owns the toggle, so adjustment can exit
// without a second double-click on the image.
assert(
  src.includes("panEditing ? \"退出调整图片\" : \"调整图片位置\""),
  "panEditing toggle in image layer panel must remain",
);

// Edge-to-edge cover guarantee: the image layer must always fill its module
// frame. Render must clamp zoom at >= 1 (combined with object-fit cover this
// prevents the page background from peeking inside the layer), and the
// wheel-zoom + zoom-out controls must not let zoom drop below 1.
assert(
  src.includes("scale(${Math.max(1, l.zoom)})"),
  "image layer render must clamp zoom to >= 1 so the photo covers the frame edge-to-edge",
);
assert(
  src.includes("clamp(layer.zoom + delta, 1, 3)"),
  "wheel zoom must clamp zoom to [1, 3] — no shrinking below the frame",
);
assert(
  src.includes("Math.max(1, Number((layer.zoom - 0.08).toFixed(2)))"),
  "settings-panel zoom-out must floor zoom at 1 to keep image edge-to-edge",
);
assert(
  !/scale\(\$\{l\.zoom\}\)/.test(src),
  "raw scale(${l.zoom}) without a min-1 clamp must not be re-introduced",
);
assert(
  !src.includes("clamp(layer.zoom + delta, 0.5, 3)"),
  "wheel zoom min of 0.5 (which allowed the image to shrink below the frame) must not return",
);

// Same edge-to-edge guarantee applies to the flat (non-interactive) render
// used in the phone preview and export pipeline.
import { readFileSync as readFileSyncFlat } from "node:fs";
const flatSrc = readFileSyncFlat(
  join(import.meta.dirname, "..", "client", "src", "components", "cover-flat.tsx"),
  "utf-8",
);
assert(
  flatSrc.includes("scale(${Math.max(1, l.zoom)})"),
  "cover-flat must also clamp zoom to >= 1 so preview matches editor cover behavior",
);

// Canvas export must mirror the cover behavior — zoom floor 1, not 0.2.
const exportSrc = readFileSyncFlat(
  join(import.meta.dirname, "..", "client", "src", "lib", "export-pages.ts"),
  "utf-8",
);
assert(
  exportSrc.includes("Math.max(1, layer.zoom || 1)"),
  "export-pages drawImageLayer must floor zoom at 1 so rasterised exports never show a frame larger than the photo",
);
assert(
  !exportSrc.includes("Math.max(0.2, layer.zoom"),
  "export-pages must not retain the old 0.2 zoom floor that let the export crop smaller than the frame",
);

console.log("OK: image-adjust presentation reverted, exit affordances intact, image covers frame edge-to-edge.");
