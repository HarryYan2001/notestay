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

console.log("OK: image-adjust presentation reverted, exit affordances intact.");
