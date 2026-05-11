import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { useApp } from "@/lib/app-state";
import { STYLE_LIST } from "@/lib/styles";
import { generateNote } from "@/lib/generate";
import type { UploadedImage } from "@/lib/types";
import {
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Image as ImageIcon,
  Link2,
  Info,
  ChevronRight,
  ArrowRight,
} from "lucide-react";

const IMAGE_CATEGORIES = ["外观", "大堂", "房间", "床品", "浴室", "早餐", "夜景", "周边", "其他"];

export default function CreatePage() {
  const [, navigate] = useLocation();
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [agentStep, setAgentStep] = useState(0);

  function addFrameworkField() {
    const id = `f${Date.now()}`;
    app.setFramework([...app.state.framework, { id, label: "新增维度", value: "" }]);
  }
  function updateFrameworkField(id: string, key: "label" | "value", v: string) {
    app.setFramework(app.state.framework.map((f) => (f.id === id ? { ...f, [key]: v } : f)));
  }
  function removeFrameworkField(id: string) {
    app.setFramework(app.state.framework.filter((f) => f.id !== id));
  }

  function onPickFiles(files: FileList | null) {
    if (!files) return;
    const next: UploadedImage[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      next.push({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(file),
        name: file.name,
        category: guessCategory(file.name),
      });
    });
    if (next.length) app.addImages(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  function guessCategory(name: string): string {
    const n = name.toLowerCase();
    if (/(lobby|大堂)/.test(n)) return "大堂";
    if (/(bath|shower|浴|tub)/.test(n)) return "浴室";
    if (/(bed|room|房)/.test(n)) return "房间";
    if (/(breakfast|brunch|早餐|food|meal)/.test(n)) return "早餐";
    if (/(night|夜|view)/.test(n)) return "夜景";
    if (/(exterior|外|facade)/.test(n)) return "外观";
    return "其他";
  }

  async function handleGenerate() {
    setGenerating(true);
    setAgentStep(0);
    // simulate 3-agent pipeline
    const steps = [
      "内容理解 Agent · 解析素材与心得",
      "视觉优化 Agent · 排版与封面建议",
      "互动提升 Agent · 标题、标签与评论引导",
    ];
    for (let i = 0; i < steps.length; i++) {
      setAgentStep(i + 1);
      await new Promise((r) => setTimeout(r, 650));
    }
    const note = generateNote(app.state);
    app.setGenerated(note);
    setGenerating(false);
    navigate("/result");
  }

  const canGenerate =
    (app.state.inputMode === "framework"
      ? app.state.framework.some((f) => f.value.trim())
      : app.state.freeText.trim().length > 0) ||
    app.state.hotel.name.trim().length > 0 ||
    app.state.images.length > 0;

  return (
    <AppShell>
      {/* Generate overlay */}
      {generating && <GenerateOverlay step={agentStep} />}

      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Step 1 / 2</div>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">素材输入</h1>
            <p className="mt-2 text-sm text-muted-foreground max-w-xl">
              上传你的实拍照片,填写你的真实心得。我们只基于你提供的内容生成笔记,空字段不会被填空。
            </p>
          </div>
          <button
            type="button"
            data-testid="button-generate"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground font-medium shadow-md disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95"
          >
            <Sparkles className="size-4" />
            生成笔记
            <ArrowRight className="size-4" />
          </button>
        </div>

        {/* Rules banner */}
        <div
          className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 flex gap-3 text-sm"
          data-testid="banner-rules"
        >
          <Info className="size-4 mt-0.5 text-primary shrink-0" />
          <div className="leading-relaxed text-foreground/85">
            <strong>内容规则:</strong>
            我们不会编造你未提供的价格、服务体验、设施细节;信息不足时会自动用中性表述或提示你补充。
            爆款笔记参考仅用于结构 / 节奏 / 标题逻辑分析,不会复制原文与图片。
          </div>
        </div>

        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          {/* LEFT: text & hotel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Text input switch */}
            <Section title="文案输入" subtitle="选择你习惯的写法,任选其一即可" testId="section-text">
              <div className="flex gap-2 mb-4" role="tablist">
                {(["framework", "freeform"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    data-testid={`tab-mode-${mode}`}
                    onClick={() => app.setInputMode(mode)}
                    className={`px-4 py-1.5 rounded-full text-sm transition ${
                      app.state.inputMode === mode
                        ? "bg-foreground text-background"
                        : "bg-card border border-card-border hover-elevate"
                    }`}
                  >
                    {mode === "framework" ? "A · 框架化输入" : "B · 自由心得"}
                  </button>
                ))}
              </div>

              {app.state.inputMode === "framework" ? (
                <div className="space-y-3">
                  {app.state.framework.map((f) => (
                    <div
                      key={f.id}
                      className="rounded-xl border border-card-border bg-card p-3 md:p-4"
                      data-testid={`framework-field-${f.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={f.label}
                          onChange={(e) => updateFrameworkField(f.id, "label", e.target.value)}
                          className="flex-1 bg-transparent text-sm font-medium px-2 py-1 rounded border border-transparent hover:border-border focus:border-primary focus:outline-none"
                          data-testid={`input-framework-label-${f.id}`}
                          placeholder="维度名称(如:第一印象)"
                        />
                        <button
                          type="button"
                          onClick={() => removeFrameworkField(f.id)}
                          className="size-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover-elevate"
                          data-testid={`button-remove-framework-${f.id}`}
                          aria-label="删除维度"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      <textarea
                        value={f.value}
                        onChange={(e) => updateFrameworkField(f.id, "value", e.target.value)}
                        rows={3}
                        placeholder="在这里写下你对这一维度的真实感受"
                        className="mt-2 w-full bg-transparent text-sm rounded-md border border-input p-2 focus:border-primary focus:outline-none resize-none"
                        data-testid={`input-framework-value-${f.id}`}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addFrameworkField}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover-elevate"
                    data-testid="button-add-framework"
                  >
                    <Plus className="size-4" />
                    新增测评维度
                  </button>
                </div>
              ) : (
                <textarea
                  rows={10}
                  value={app.state.freeText}
                  onChange={(e) => app.setFreeText(e.target.value)}
                  placeholder="自由描述这次入住的真实感受,我们会帮你润色成测评文案。例如:位置 / 房型 / 卫生 / 服务 / 早餐 / 性价比 / 想推荐给谁……"
                  className="w-full text-sm rounded-xl border border-input bg-card p-3 focus:border-primary focus:outline-none resize-y"
                  data-testid="input-freeform"
                />
              )}
            </Section>

            {/* Hotel info */}
            <Section
              title="酒店基础信息"
              subtitle="仅填写真实信息,留空我们不会替你瞎编"
              testId="section-hotel"
            >
              <div className="grid sm:grid-cols-2 gap-3">
                <Field
                  label="酒店名称"
                  testId="input-hotel-name"
                  value={app.state.hotel.name}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, name: v })}
                  placeholder="如:上海外滩 W 酒店"
                />
                <Field
                  label="品牌"
                  testId="input-hotel-brand"
                  value={app.state.hotel.brand}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, brand: v })}
                  placeholder="如:万豪 / 凯悦 / 安缦"
                />
                <Field
                  label="城市"
                  testId="input-hotel-city"
                  value={app.state.hotel.city}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, city: v })}
                  placeholder="如:上海"
                />
                <Field
                  label="参考价格"
                  testId="input-hotel-price"
                  value={app.state.hotel.price}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, price: v })}
                  placeholder="如:¥1280/晚(以本人订单为准)"
                />
                <Field
                  label="房型"
                  testId="input-hotel-room"
                  value={app.state.hotel.roomType}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, roomType: v })}
                  placeholder="如:外滩景观大床房"
                />
                <Field
                  label="入住时间"
                  testId="input-hotel-date"
                  value={app.state.hotel.stayDate}
                  onChange={(v) => app.setHotel({ ...app.state.hotel, stayDate: v })}
                  placeholder="如:2025年3月"
                />
              </div>
            </Section>

            {/* Viral reference */}
            <Section
              title="爆款笔记学习(可选)"
              subtitle="只学结构 / 节奏 / 标题逻辑,绝不复制原文与原图"
              testId="section-viral"
            >
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-muted-foreground" />
                <input
                  type="url"
                  value={app.state.viralRef}
                  onChange={(e) => app.setViralRef(e.target.value)}
                  placeholder="粘贴一篇你想参考的小红书爆款笔记链接"
                  className="flex-1 text-sm bg-card border border-input rounded-md px-3 py-2 focus:border-primary focus:outline-none"
                  data-testid="input-viral-link"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                我们会分析该笔记的结构、节奏、标题与排版逻辑,作为版式参考;
                不会抄袭原文文字、原图与作者个人内容。
              </p>
            </Section>
          </div>

          {/* RIGHT: images & styles */}
          <div className="space-y-6">
            {/* Images */}
            <Section
              title="图片上传"
              subtitle="实拍照片会按外观 / 房间 / 早餐等自动归类"
              testId="section-images"
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickFiles(e.target.files)}
                data-testid="input-file"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-border bg-card/60 p-5 flex flex-col items-center gap-2 text-sm text-muted-foreground hover-elevate"
                data-testid="button-upload"
              >
                <div className="size-9 rounded-xl bg-primary/10 text-primary inline-flex items-center justify-center">
                  <Upload className="size-4" />
                </div>
                <div className="font-medium text-foreground">点击上传你的实拍照片</div>
                <div className="text-xs">支持多选 · 仅本会话内保存,不上传服务器</div>
              </button>

              {app.state.images.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2" data-testid="grid-images">
                  {app.state.images.map((img) => (
                    <div
                      key={img.id}
                      className="relative rounded-lg overflow-hidden border border-card-border group aspect-square"
                      data-testid={`image-thumb-${img.id}`}
                    >
                      <img
                        src={img.url}
                        alt={img.name}
                        className="absolute inset-0 size-full object-cover"
                      />
                      <select
                        value={img.category}
                        onChange={(e) => app.setImageCategory(img.id, e.target.value)}
                        className="absolute top-1 left-1 right-1 text-[10px] rounded bg-black/60 text-white px-1 py-0.5 border-0"
                        data-testid={`select-image-category-${img.id}`}
                      >
                        {IMAGE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => app.removeImage(img.id)}
                        className="absolute bottom-1 right-1 size-6 rounded-full bg-black/60 text-white inline-flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        data-testid={`button-remove-image-${img.id}`}
                        aria-label="删除图片"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {app.state.images.length === 0 && (
                <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="size-3.5 mt-0.5" />
                  暂未上传图片。生成结果会以渐变占位版式作为参考,不会假装已有实拍画面。
                </div>
              )}
            </Section>

            {/* Style picker */}
            <Section title="风格偏好" subtitle="选择一种主风格,生成后可继续切换" testId="section-style">
              <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1 scroll-area-hide">
                {STYLE_LIST.map((s) => {
                  const active = app.state.style === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => app.setStyle(s.key)}
                      className={`relative text-left rounded-xl overflow-hidden border aspect-[4/3] ${
                        active ? "border-primary ring-2 ring-primary/50" : "border-card-border"
                      }`}
                      data-testid={`button-style-${s.key}`}
                      style={{
                        background: `linear-gradient(140deg, ${s.palette[0]}, ${s.palette[1]} 55%, ${s.palette[2]})`,
                      }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                      <div className="absolute inset-0 p-2.5 flex flex-col justify-between text-white">
                        <div className="text-[9px] uppercase tracking-[0.18em] opacity-80">{s.english}</div>
                        <div>
                          <div className="text-sm font-bold">{s.name}</div>
                          <div className="text-[10px] opacity-85 line-clamp-1">{s.vibe}</div>
                        </div>
                      </div>
                      {active && (
                        <span className="absolute top-1.5 right-1.5 size-4 rounded-full bg-white text-primary text-[10px] inline-flex items-center justify-center">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Section>

            <button
              type="button"
              data-testid="button-generate-bottom"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground font-medium shadow-md disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95"
            >
              <Sparkles className="size-4" />
              生成笔记
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-2xl border border-card-border bg-card/70 backdrop-blur-sm p-5 md:p-6"
      data-testid={testId}
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full text-sm bg-background border border-input rounded-md px-3 py-2 focus:border-primary focus:outline-none"
        data-testid={testId}
      />
    </label>
  );
}

function GenerateOverlay({ step }: { step: number }) {
  const steps = [
    { name: "内容理解 Agent", desc: "解析心得 + 实拍 + 酒店信息" },
    { name: "视觉优化 Agent", desc: "封面、内页与排版建议" },
    { name: "互动提升 Agent", desc: "标题、标签与评论引导" },
  ];
  return (
    <div
      className="fixed inset-0 z-50 bg-background/85 backdrop-blur-xl flex items-center justify-center p-6"
      data-testid="overlay-generate"
    >
      <div className="max-w-md w-full">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            生成中
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">正在为你生成笔记…</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            三位 Agent 协作完成内容、版式与互动建议。
          </p>
        </div>
        <ol className="mt-8 space-y-3">
          {steps.map((s, i) => {
            const idx = i + 1;
            const done = step > idx;
            const active = step === idx;
            return (
              <li
                key={s.name}
                className={`rounded-xl border p-4 flex gap-3 items-start transition ${
                  active
                    ? "border-primary bg-primary/5"
                    : done
                    ? "border-card-border bg-card"
                    : "border-card-border bg-card/40 opacity-70"
                }`}
                data-testid={`agent-step-${idx}`}
              >
                <div
                  className={`size-7 rounded-full inline-flex items-center justify-center text-xs font-semibold ${
                    done
                      ? "bg-primary text-primary-foreground"
                      : active
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? "✓" : idx}
                </div>
                <div>
                  <div className="text-sm font-semibold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
