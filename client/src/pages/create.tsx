import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import {
  hasFrameworkContent,
  hasFreeformContent,
  useApp,
} from "@/lib/app-state";
import { STYLE_LIST } from "@/lib/styles";
import { generateNoteWithAi, AiNotConfiguredError } from "@/lib/ai-generate";
import {
  analyzeScreenshotText,
  DEFAULT_TEXT_STYLE_STRENGTH,
  TEXT_CUE_LABELS,
  TEXT_STYLE_STRENGTH_DESCRIPTIONS,
  TEXT_STYLE_STRENGTH_LABELS,
  TEXT_STYLE_STRENGTH_LEVELS,
  TEXT_TONE_LABELS,
} from "@/lib/screenshot-text-style";
import { recognizeScreenshotText } from "@/lib/screenshot-ocr";
import type {
  InputMode,
  ScreenshotRef,
  ScreenshotTextStyleRef,
  TextStyleStrength,
  UploadedImage,
} from "@/lib/types";
import {
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Image as ImageIcon,
  ImagePlus,
  Info,
  ChevronRight,
  ArrowRight,
  LayoutTemplate,
  Save,
  Check,
  Loader2,
  X,
} from "lucide-react";

const IMAGE_CATEGORIES = ["外观", "大堂", "房间", "床品", "浴室", "早餐", "夜景", "周边", "其他"];

export default function CreatePage() {
  const [, navigate] = useLocation();
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [agentStep, setAgentStep] = useState(0);
  // True while OCR is running on the uploaded screenshot. OCR is heavier
  // than a metadata read (we lazy-load tesseract.js + WASM + language data),
  // so we expose it as a separate state and surface a spinner.
  const [ocrRunning, setOcrRunning] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  // Surfaces backend errors from the AI generation route (missing
  // ZHIPU_API_KEY, model failure, etc.) so the UI can clearly say "AI 生成
  // 服务未配置" rather than silently rendering deterministic template output.
  const [aiError, setAiError] = useState<string | null>(null);

  async function onPickScreenshot(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setScreenshotError("请上传一张图片(支持 PNG/JPG/WEBP)。");
      return;
    }
    setScreenshotError(null);
    // Create the preview thumbnail synchronously so the user sees feedback
    // immediately. Visual analysis has been removed — we only need the
    // object URL + filename to render the panel header.
    const previewUrl = typeof URL !== "undefined" ? URL.createObjectURL(file) : null;
    const baseRef: ScreenshotRef = {
      previewUrl,
      filename: file.name,
      textStyle: null,
    };
    app.setScreenshotRef(baseRef);
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";

    // OCR pass — the only learning step. We extract the body text style
    // of the reference note and persist it into app state. We never
    // analyze pixels for visual cues anymore.
    setOcrRunning(true);
    try {
      const ocr = await recognizeScreenshotText(file);
      const textProfile = analyzeScreenshotText(ocr.text);
      const trimmedPreview = ocr.text.replace(/\s+/g, " ").trim().slice(0, 240);
      const textStyle: ScreenshotTextStyleRef = {
        hasText: textProfile.hasText,
        charCount: textProfile.charCount,
        cjkCount: textProfile.cjkCount,
        tone: textProfile.tone,
        cues: textProfile.cues,
        detectedEmoji: textProfile.detectedEmoji,
        punctIntensity: textProfile.punctIntensity,
        avgSentenceLen: textProfile.avgSentenceLen,
        hashtagCount: textProfile.hashtagCount,
        status: ocr.ok
          ? textProfile.hasText
            ? textProfile.status
            : "OCR 已运行,但未识别到足够的中文文字,本次截图无法用于学习文字风格。"
          : "OCR 未能加载,无法学习参考截图的文字风格。请尝试更换图片或稍后再试。",
        previewText: trimmedPreview,
      };
      app.setScreenshotRef({ ...baseRef, textStyle });
    } catch (err) {
      console.warn("OCR pipeline failed", err);
      // Keep the bare ref — the panel shows the OCR failure status text.
    } finally {
      setOcrRunning(false);
    }
  }

  function clearScreenshot() {
    setScreenshotError(null);
    app.setScreenshotRef(null);
  }

  // Switch text-input mode. If the OTHER mode already has content, confirm
  // before clearing — A and B are mutually exclusive, so the previous mode's
  // content cannot ride along into the next generation.
  function requestSwitchMode(next: InputMode) {
    if (next === app.state.inputMode) return;
    const otherHasContent =
      next === "framework"
        ? hasFreeformContent(app.state)
        : hasFrameworkContent(app.state);
    if (otherHasContent) {
      const otherName = next === "framework" ? "B · 自由心得" : "A · 框架化输入";
      const ok = window.confirm(
        `切换后将清空${otherName}中已填写的内容,无法恢复。是否继续?`,
      );
      if (!ok) return;
    }
    app.switchInputMode(next);
  }

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
  // Save the current framework (labels, order, values) as a named custom
  // template. The user supplies a non-empty name via a prompt; duplicates
  // are allowed but blank names are rejected.
  function saveCurrentFramework() {
    if (app.state.framework.length === 0) {
      window.alert("当前没有任何维度可保存,请先添加至少一个维度。");
      return;
    }
    const raw = window.prompt("为这套自定义框架取个名字(例如:精品民宿 5 维度):");
    if (raw === null) return;
    const name = raw.trim();
    if (!name) {
      window.alert("模板名称不能为空。");
      return;
    }
    app.saveTemplate(name);
  }
  // Apply a previously saved custom framework. If the user has filled in any
  // value, confirm before replacing — applying a template overwrites the
  // current framework structure (labels, order) and pre-fills values from
  // the template, so unsaved changes would be lost.
  function applySavedTemplate(id: string) {
    const hasValues = app.state.framework.some((f) => f.value.trim().length > 0);
    if (hasValues) {
      const ok = window.confirm(
        "应用模板会替换当前所有维度,已填写的内容将被清空,是否继续?",
      );
      if (!ok) return;
    }
    app.applyTemplate(id);
  }
  function deleteSavedTemplate(id: string, name: string) {
    const ok = window.confirm(`确定删除模板「${name}」吗?该操作无法撤销。`);
    if (!ok) return;
    app.deleteTemplate(id);
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
    setAiError(null);
    try {
      // Stage 1: parsing user material locally (still useful as feedback).
      setAgentStep(1);
      await new Promise((r) => setTimeout(r, 250));
      // Stage 2: build visual scaffold + prepare AI prompt.
      setAgentStep(2);
      await new Promise((r) => setTimeout(r, 250));
      // Stage 3: call the AI route. This is the long step — the overlay
      // remains on "互动提升 Agent" until the model returns.
      setAgentStep(3);
      const note = await generateNoteWithAi(app.state);
      flushSync(() => {
        app.setGenerated(note);
        setGenerating(false);
      });
      navigate("/result");
    } catch (error) {
      console.error("Failed to generate note", error);
      const msg =
        error instanceof AiNotConfiguredError
          ? error.message
          : (error as Error)?.message ||
            "AI 生成失败，请稍后重试或检查 ZHIPU_API_KEY 是否已配置。";
      setAiError(msg);
      setGenerating(false);
    }
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

        {/* AI error banner — shown when /api/generate-note fails (missing key,
            network, or model error). The 生成 button stays enabled so the user
            can retry after fixing config; no silent fallback to template
            output. */}
        {aiError && (
          <div
            className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex gap-3 text-sm"
            data-testid="banner-ai-error"
          >
            <Info className="size-4 mt-0.5 text-destructive shrink-0" />
            <div className="leading-relaxed text-foreground/85">
              <strong>AI 生成失败：</strong>
              {aiError}
            </div>
          </div>
        )}

        {/* Rules banner */}
        <div
          className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 flex gap-3 text-sm"
          data-testid="banner-rules"
        >
          <Info className="size-4 mt-0.5 text-primary shrink-0" />
          <div className="leading-relaxed text-foreground/85">
            <strong>内容规则:</strong>
            我们不会编造你未提供的价格、服务体验、设施细节;信息不足时会自动用中性表述或提示你补充。
            未上传爆款笔记截图时,本应用直接按内置写作规则离线生成,速度更快;
            上传截图后才会调用云端 AI 学习其文字风格。即使云端调用失败,也会自动回落到本地规则生成,不会让你卡住。
          </div>
        </div>

        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          {/* LEFT: text & hotel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Text input switch — A and B are mutually exclusive. */}
            <Section
              title="文案输入"
              testId="section-text"
            >
              <div
                className="flex gap-2 mb-3"
                role="radiogroup"
                aria-label="文案输入模式"
                data-testid="group-input-mode"
              >
                {(["framework", "freeform"] as const).map((mode) => {
                  const active = app.state.inputMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`tab-mode-${mode}`}
                      onClick={() => requestSwitchMode(mode)}
                      className={`px-4 py-1.5 rounded-full text-sm transition ${
                        active
                          ? "bg-foreground text-background"
                          : "bg-card border border-card-border hover-elevate"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`inline-block size-2.5 rounded-full border ${
                            active
                              ? "bg-background border-background"
                              : "border-muted-foreground"
                          }`}
                        />
                        {mode === "framework" ? "A · 框架化输入" : "B · 自由心得"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p
                className="mb-4 text-[11px] text-muted-foreground"
                data-testid="hint-mode-exclusive"
              >
                {app.state.inputMode === "framework"
                  ? "当前为 A 框架化输入。生成时将仅使用下方维度内容,B 自由心得文本会被忽略。"
                  : "当前为 B 自由心得。生成时将仅使用下方自由文本,A 维度内容会被忽略。"}
              </p>

              {app.state.inputMode === "framework" ? (
                <div className="space-y-3">
                  <div
                    className="rounded-xl border border-dashed border-border bg-card/40 p-3 space-y-2"
                    data-testid="framework-templates"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                        <LayoutTemplate className="size-3.5" />
                        我的自定义框架(刷新后自动保留)
                      </div>
                      <button
                        type="button"
                        onClick={saveCurrentFramework}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 text-primary px-3 py-1 text-xs hover-elevate"
                        data-testid="button-save-framework-template"
                        title="将当前维度名称、顺序与内容保存为命名模板"
                      >
                        <Save className="size-3.5" />
                        保存为模板
                      </button>
                    </div>
                    {app.templates.length === 0 ? (
                      <p
                        className="text-[10px] text-muted-foreground"
                        data-testid="hint-no-templates"
                      >
                        尚未保存任何模板。先编辑下方维度的名称、顺序与内容,然后点击「保存为模板」并取名,下次进入页面或刷新后即可一键应用。
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2" data-testid="framework-template-list">
                        {app.templates.map((tpl) => (
                          <div
                            key={tpl.id}
                            className="inline-flex items-stretch rounded-xl border border-card-border bg-background overflow-hidden"
                            data-testid={`framework-template-${tpl.id}`}
                          >
                            <button
                              type="button"
                              onClick={() => applySavedTemplate(tpl.id)}
                              className="text-left px-3 py-1.5 hover-elevate inline-flex items-center gap-1.5"
                              data-testid={`framework-template-apply-${tpl.id}`}
                              title={`应用模板「${tpl.name}」(${tpl.fields.length} 个维度)`}
                            >
                              <Check className="size-3 text-primary" />
                              <span className="text-xs font-semibold">{tpl.name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                · {tpl.fields.length} 维度
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSavedTemplate(tpl.id, tpl.name)}
                              className="px-2 inline-flex items-center justify-center text-muted-foreground hover:text-destructive border-l border-card-border"
                              data-testid={`framework-template-delete-${tpl.id}`}
                              title={`删除模板「${tpl.name}」`}
                              aria-label={`删除模板 ${tpl.name}`}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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

            {/* Screenshot-based viral-style learning (OCR-only). */}
            <Section
              title="爆款笔记正文风格学习(可选)"
              subtitle="上传目标小红书笔记的截图,我们会通过 OCR 识别正文文字,只学习它的语气、节奏与互动钩子,不复制原文,也不影响封面与内页的视觉。"
              testId="section-viral"
            >
              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickScreenshot(e.target.files?.[0] ?? null)}
                data-testid="input-screenshot-file"
              />
              {!app.state.screenshotRef ? (
                <button
                  type="button"
                  onClick={() => screenshotInputRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-border bg-card/60 p-5 flex flex-col items-center gap-2 text-sm text-muted-foreground hover-elevate"
                  data-testid="button-upload-screenshot"
                >
                  <div className="size-9 rounded-xl bg-primary/10 text-primary inline-flex items-center justify-center">
                    <ImagePlus className="size-4" />
                  </div>
                  <div className="font-medium text-foreground">
                    上传目标笔记截图,识别正文风格
                  </div>
                  <div className="text-xs">
                    PNG / JPG / WEBP · 仅本会话内通过 OCR 学习正文文字,不上传服务器
                  </div>
                </button>
              ) : (
                <ScreenshotPanel
                  refData={app.state.screenshotRef}
                  onReplace={() => screenshotInputRef.current?.click()}
                  onClear={clearScreenshot}
                  ocrRunning={ocrRunning}
                  textStyleStrength={
                    app.state.textStyleStrength ?? DEFAULT_TEXT_STYLE_STRENGTH
                  }
                  onChangeTextStyleStrength={app.setTextStyleStrength}
                />
              )}
              {screenshotError && (
                <p
                  className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"
                  data-testid="screenshot-learning-error"
                >
                  {screenshotError}
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                受小红书登录态和反爬规则限制,本应用无法抓取链接，通过上传图片OCR的方案实现该功能
              </p>
            </Section>
          </div>

          {/* RIGHT: images & styles */}
          <div className="space-y-6">
            {/* Images */}
            <Section
              title="图片上传"
              subtitle="上传图片后，可以设置照片类型"
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

// Renders the uploaded reference-note screenshot + the OCR-derived text
// style we learned from it. Visible only after the user picks a screenshot.
// Visual / image-style learning has been removed — we no longer surface
// palette, mood, accent or visual cue chips. Only the thumbnail + OCR
// progress + text-style summary are shown.
function ScreenshotPanel({
  refData,
  onReplace,
  onClear,
  ocrRunning,
  textStyleStrength,
  onChangeTextStyleStrength,
}: {
  refData: ScreenshotRef;
  onReplace: () => void;
  onClear: () => void;
  ocrRunning: boolean;
  textStyleStrength: TextStyleStrength;
  onChangeTextStyleStrength: (s: TextStyleStrength) => void;
}) {
  const [showOcrText, setShowOcrText] = useState(false);
  const textStyle = refData.textStyle;
  const textToneLabel = textStyle
    ? TEXT_TONE_LABELS[textStyle.tone as keyof typeof TEXT_TONE_LABELS] ?? textStyle.tone
    : null;
  // Status copy for the OCR sub-panel.
  let ocrStatus: string;
  if (ocrRunning) {
    ocrStatus = "正在识别截图中的文字…(首次需下载 OCR 引擎,可能需要数十秒)";
  } else if (!textStyle) {
    ocrStatus = "文字识别尚未开始或已被跳过。";
  } else {
    ocrStatus = textStyle.status;
  }
  return (
    <div className="space-y-3" data-testid="screenshot-learning-panel">
      <div className="flex gap-3 items-start">
        {refData.previewUrl ? (
          <div
            className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-card-border bg-muted"
            data-testid="screenshot-learning-thumb"
          >
            <img
              src={refData.previewUrl}
              alt={refData.filename || "reference screenshot"}
              className="absolute inset-0 size-full object-cover"
            />
          </div>
        ) : (
          <div className="size-20 shrink-0 rounded-xl border border-dashed border-border bg-card/60" />
        )}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            {refData.filename && (
              <span
                className="text-[10px] text-muted-foreground truncate max-w-[16rem]"
                data-testid="screenshot-learning-filename"
                title={refData.filename}
              >
                {refData.filename}
              </span>
            )}
          </div>
          <p
            className="text-[10px] text-muted-foreground leading-relaxed"
            data-testid="screenshot-learning-status-text"
          >
            截图只用于 OCR 识别正文文字,以学习语气与节奏;封面、内页与图片风格完全不受影响。
          </p>
        </div>
      </div>
      {/* OCR / text-style learning sub-panel. Shows running state, learned
          tone+cues, and an opt-in expandable preview of the recognized text
          (purely informational — the generator never copies it). */}
      <div
        className="rounded-xl border border-dashed border-border bg-background/60 p-3 space-y-2"
        data-testid="screenshot-text-learning-panel"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            文字风格学习 · OCR
          </span>
          {ocrRunning && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
              data-testid="screenshot-text-learning-running"
            >
              <Loader2 className="size-3 animate-spin" /> 识别中
            </span>
          )}
          {!ocrRunning && textStyle?.hasText && (
            <span
              className="inline-flex items-center rounded-full bg-foreground text-background px-2 py-0.5 text-[10px] font-semibold"
              data-testid="screenshot-text-learning-tone"
            >
              {textToneLabel}
            </span>
          )}
          {!ocrRunning && textStyle && !textStyle.hasText && (
            <span
              className="text-[10px] text-muted-foreground"
              data-testid="screenshot-text-learning-empty"
            >
              未识别到足够文字
            </span>
          )}
        </div>
        {!ocrRunning && textStyle?.hasText && textStyle.cues.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1"
            data-testid="screenshot-text-learning-cues"
          >
            {textStyle.cues.map((cue) => (
              <span
                key={cue}
                className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium border border-primary/30"
                data-testid={`screenshot-text-cue-${cue}`}
              >
                {TEXT_CUE_LABELS[cue as keyof typeof TEXT_CUE_LABELS] ?? cue}
              </span>
            ))}
          </div>
        )}
        <p
          className="text-[10px] text-muted-foreground leading-relaxed"
          data-testid="screenshot-text-learning-status"
        >
          {ocrStatus}
        </p>
        {textStyle?.hasText && textStyle.previewText && (
          <div className="text-[10px]">
            <button
              type="button"
              onClick={() => setShowOcrText((v) => !v)}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              data-testid="button-toggle-ocr-preview"
            >
              <ChevronRight
                className={`size-3 transition ${showOcrText ? "rotate-90" : ""}`}
              />
              {showOcrText ? "收起识别文字" : "查看识别到的文字片段"}
            </button>
            {showOcrText && (
              <div
                className="mt-1 rounded-lg border border-card-border bg-card/70 p-2 leading-relaxed"
                data-testid="screenshot-text-learning-preview"
              >
                <p className="text-amber-700 dark:text-amber-300 mb-1">
                  仅用于风格学习,不复制内容。
                </p>
                <p className="text-muted-foreground whitespace-pre-wrap break-words">
                  {textStyle.previewText}
                </p>
              </div>
            )}
          </div>
        )}
        {/* 文字风格模仿强度. Only render once OCR successfully learned a text
            style — for empty / failed OCR there is nothing to bend. The
            control sits inside React state for this flow only, no storage. */}
        {!ocrRunning && textStyle?.hasText && (
          <div
            className="pt-1 space-y-1.5"
            data-testid="screenshot-text-strength-control"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                文字风格模仿强度
              </span>
              <span
                className="text-[10px] text-muted-foreground"
                data-testid="screenshot-text-strength-current"
              >
                当前：{TEXT_STYLE_STRENGTH_LABELS[textStyleStrength]}
              </span>
            </div>
            <div
              role="radiogroup"
              aria-label="文字风格模仿强度"
              className="inline-flex w-full rounded-full border border-card-border bg-card/70 p-0.5"
            >
              {TEXT_STYLE_STRENGTH_LEVELS.map((level) => {
                const active = level === textStyleStrength;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChangeTextStyleStrength(level)}
                    className={`flex-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid={`button-text-strength-${level}`}
                    aria-label={`${TEXT_STYLE_STRENGTH_LABELS[level]}：${TEXT_STYLE_STRENGTH_DESCRIPTIONS[level]}`}
                  >
                    {TEXT_STYLE_STRENGTH_LABELS[level]}
                  </button>
                );
              })}
            </div>
            <p
              className="text-[10px] text-muted-foreground leading-relaxed"
              data-testid="screenshot-text-strength-description"
            >
              {TEXT_STYLE_STRENGTH_DESCRIPTIONS[textStyleStrength]}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onReplace}
          disabled={ocrRunning}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate disabled:opacity-60"
          data-testid="button-screenshot-replace"
        >
          {ocrRunning ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ImagePlus className="size-3" />
          )}
          {ocrRunning ? "正在识别文字…" : "换一张截图"}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] hover-elevate"
          data-testid="button-screenshot-clear"
        >
          <X className="size-3" /> 清除截图
        </button>
      </div>
    </div>
  );
}

function GenerateOverlay({ step }: { step: number }) {
  const steps = [
    { name: "内容理解 Agent", desc: "解析心得 + 实拍 + 酒店信息" },
    { name: "视觉优化 Agent", desc: "按图片类别选主图,用黄金分割优化封面视觉重点" },
    { name: "正文撰写 Agent · 智谱大模型", desc: "调用 AI 生成标题、正文、标签与评论引导" },
  ];
  // The 3rd step is the long upstream Zhipu call. While we wait for it,
  // creep the progress from the "step 3 starts" mark (~66%) toward 95% so
  // the bar feels alive instead of frozen — capped under 100% so the
  // completion frame still feels like a real finish.
  const baseByStep: Record<number, number> = { 0: 0, 1: 8, 2: 38, 3: 66 };
  const target = baseByStep[Math.max(0, Math.min(3, step))] ?? 0;
  const [progress, setProgress] = useState(target);
  useEffect(() => {
    setProgress((prev) => Math.max(prev, target));
  }, [target]);
  useEffect(() => {
    if (step !== 3) return;
    const id = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        const remaining = 95 - prev;
        return prev + Math.max(0.4, remaining * 0.04);
      });
    }, 320);
    return () => window.clearInterval(id);
  }, [step]);
  const pct = Math.min(95, Math.max(0, progress));
  return (
    <div
      className="fixed inset-0 z-50 bg-background/85 backdrop-blur-xl flex items-center justify-center p-6"
      data-testid="overlay-generate"
    >
      <div className="max-w-md w-full">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            正在调用 AI 生成笔记
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">正在为你生成笔记…</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            正文由智谱 AI 实时生成，封面与版式仍由本地视觉优化器排版。
          </p>
        </div>
        <div className="mt-6" data-testid="generate-progress">
          <div className="flex items-center justify-between text-[11px] font-medium">
            <span className="text-muted-foreground">
              Step {Math.max(1, Math.min(3, step || 1))} / 3
            </span>
            <span
              className="tabular-nums text-primary"
              data-testid="generate-progress-pct"
            >
              {Math.round(pct)}%
            </span>
          </div>
          <div
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-primary/10 ring-1 ring-primary/15"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="生成进度"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/70 via-primary to-primary/80 shadow-[0_0_12px_hsl(var(--primary)/0.45)] transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <ol className="mt-6 space-y-3">
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
