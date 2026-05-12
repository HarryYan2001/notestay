import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppInputState,
  FrameworkField,
  GeneratedNote,
  HotelInfo,
  InputMode,
  StyleKey,
  UploadedImage,
} from "./types";
import {
  readFrameworkFromUrl,
  writeFrameworkToUrl,
} from "./framework-persist";

const DEFAULT_FRAMEWORK: FrameworkField[] = [
  { id: "f1", label: "第一印象", value: "" },
  { id: "f2", label: "房间空间", value: "" },
  { id: "f3", label: "服务体验", value: "" },
  { id: "f4", label: "早餐 / 餐饮", value: "" },
  { id: "f5", label: "周边 / 地理位置", value: "" },
  { id: "f6", label: "推荐理由 / 不推荐之处", value: "" },
];

const DEFAULT_HOTEL: HotelInfo = {
  name: "",
  brand: "",
  city: "",
  price: "",
  roomType: "",
  stayDate: "",
};

export const DEFAULT_INPUT: AppInputState = {
  inputMode: "framework",
  framework: DEFAULT_FRAMEWORK,
  freeText: "",
  hotel: DEFAULT_HOTEL,
  images: [],
  style: "xhs_burst",
  viralRef: "",
  viralRefNotes: "",
};

interface AppCtx {
  state: AppInputState;
  setState: React.Dispatch<React.SetStateAction<AppInputState>>;
  setInputMode: (m: InputMode) => void;
  // Switch mode and clear data from the OTHER mode. The two text-input modes
  // are mutually exclusive — when the user switches, the previous mode's
  // content must not leak forward into the new mode's generation.
  switchInputMode: (m: InputMode) => void;
  setFramework: (f: FrameworkField[]) => void;
  setFreeText: (t: string) => void;
  setHotel: (h: HotelInfo) => void;
  addImages: (imgs: UploadedImage[]) => void;
  removeImage: (id: string) => void;
  setImageCategory: (id: string, category: string) => void;
  setStyle: (s: StyleKey) => void;
  setViralRef: (s: string) => void;
  generated: GeneratedNote | null;
  setGenerated: (g: GeneratedNote | null) => void;
  reset: () => void;
}

// Predicates exported so create.tsx can detect when switching modes would
// discard user content (so we can prompt the user before clearing).
export function hasFrameworkContent(s: AppInputState): boolean {
  return s.framework.some((f) => f.value.trim().length > 0);
}
export function hasFreeformContent(s: AppInputState): boolean {
  return s.freeText.trim().length > 0;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Hydrate framework from URL synchronously so the first render already shows
  // the user's last-known custom framework. We keep this read inside the
  // initializer (lazy) to avoid running it during SSR or tests where window
  // may not exist; the helper returns null in that case.
  const [state, setState] = useState<AppInputState>(() => {
    const persisted = readFrameworkFromUrl();
    if (persisted && persisted.length > 0) {
      return { ...DEFAULT_INPUT, framework: persisted };
    }
    return DEFAULT_INPUT;
  });
  const [generated, setGenerated] = useState<GeneratedNote | null>(null);

  // Persist framework state to the URL whenever it changes. This is our
  // refresh-survival mechanism on static deploys (GitHub Pages) without
  // touching localStorage / sessionStorage / IndexedDB / cookies.
  // We don't write on the very first effect run because the value just came
  // *from* the URL — writing back would be a no-op churn that pushes a
  // history entry on browsers that ignore replaceState semantics.
  const initialFrameworkRef = useRef(state.framework);
  useEffect(() => {
    if (state.framework === initialFrameworkRef.current) return;
    writeFrameworkToUrl(state.framework);
  }, [state.framework]);

  const value = useMemo<AppCtx>(
    () => ({
      state,
      setState,
      setInputMode: (m) => setState((s) => ({ ...s, inputMode: m })),
      switchInputMode: (m) =>
        setState((s) => {
          if (s.inputMode === m) return s;
          // Drop the other mode's data so it cannot leak into the next
          // generation. Framework keeps its labels (default scaffolding)
          // but all values reset to empty.
          if (m === "framework") {
            return {
              ...s,
              inputMode: m,
              freeText: "",
            };
          }
          return {
            ...s,
            inputMode: m,
            framework: s.framework.map((f) => ({ ...f, value: "" })),
          };
        }),
      setFramework: (f) => setState((s) => ({ ...s, framework: f })),
      setFreeText: (t) => setState((s) => ({ ...s, freeText: t })),
      setHotel: (h) => setState((s) => ({ ...s, hotel: h })),
      addImages: (imgs) => setState((s) => ({ ...s, images: [...s.images, ...imgs] })),
      removeImage: (id) =>
        setState((s) => ({ ...s, images: s.images.filter((i) => i.id !== id) })),
      setImageCategory: (id, category) =>
        setState((s) => ({
          ...s,
          images: s.images.map((i) => (i.id === id ? { ...i, category } : i)),
        })),
      setStyle: (st) => setState((s) => ({ ...s, style: st })),
      setViralRef: (v) => setState((s) => ({ ...s, viralRef: v })),
      generated,
      setGenerated,
      reset: () => {
        setState(DEFAULT_INPUT);
        setGenerated(null);
      },
    }),
    [state, generated]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppStateProvider missing");
  return v;
}
