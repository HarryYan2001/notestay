import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  AppInputState,
  FrameworkField,
  GeneratedNote,
  HotelInfo,
  InputMode,
  StyleKey,
  UploadedImage,
} from "./types";

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

const Ctx = createContext<AppCtx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppInputState>(DEFAULT_INPUT);
  const [generated, setGenerated] = useState<GeneratedNote | null>(null);

  const value = useMemo<AppCtx>(
    () => ({
      state,
      setState,
      setInputMode: (m) => setState((s) => ({ ...s, inputMode: m })),
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
