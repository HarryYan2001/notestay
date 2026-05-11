import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { STYLE_LIST } from "@/lib/styles";
import {
  Sparkles,
  Image as ImageIcon,
  Layout,
  PenLine,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";

const FEATURES = [
  {
    icon: PenLine,
    title: "两种文案输入",
    body: "框架化结构 + 自由心得双模式,博主自定义字段,信息缺失时如实提示。",
  },
  {
    icon: ImageIcon,
    title: "实拍图片归类",
    body: "上传你的实拍照片,工具自动按外观 / 房间 / 早餐分类,作为内页排版的真实素材。",
  },
  {
    icon: Sparkles,
    title: "三位 AI Agent 协作",
    body: "内容理解 / 视觉优化 / 互动提升三段式协作,生成标题、正文、版式与评论引导。",
  },
  {
    icon: Layout,
    title: "小红书风格图文笔记",
    body: "封面 + 内页 + 大字标题 + 贴纸文案,直接生成可上手发布的完整笔记。",
  },
  {
    icon: MessageCircle,
    title: "评论区运营建议",
    body: "为博主预设若干高互动评论种子,引导真实读者讨论,而非刷量。",
  },
  {
    icon: ShieldCheck,
    title: "不编造未提供的信息",
    body: "未填写的价格、服务细节、设施信息一律不出现在正文,避免博主翻车。",
  },
];

const STEPS = [
  { n: "01", title: "上传实拍与文字心得", body: "实拍照片 + 框架/自由文案,两步搞定素材准备。" },
  { n: "02", title: "选择风格 + 可选爆款参考", body: "12+ 种主流风格,可选填爆款笔记链接,只学结构不抄文。" },
  { n: "03", title: "一键生成可发布笔记", body: "标题、正文、贴纸、内页版式、评论引导,所见即所得手机预览。" },
];

export default function Home() {
  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-visible min-h-[calc(100svh-64px)] flex items-center">
        <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-8 md:py-10">
          <div className="grid md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7">
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                data-testid="badge-hero-tag"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                垂直酒店赛道 · AI 测评创作工具
              </div>
              <h1
                className="mt-5 font-bold tracking-tight text-balance"
                data-testid="text-hero-headline"
                style={{ fontSize: "clamp(2.4rem, 5.4vw, 4.2rem)", lineHeight: 1.05 }}
              >
                酒店美好,
                <br className="sm:hidden" />
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      "linear-gradient(95deg, hsl(14 92% 60%) 0%, hsl(358 82% 56%) 55%, hsl(345 70% 46%) 100%)",
                    WebkitBackgroundClip: "text",
                  }}
                >
                  一键记住
                </span>
              </h1>
              <p
                className="mt-5 text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed"
                data-testid="text-hero-sub"
              >
                <strong className="text-foreground">记住 NoteStay</strong> 是为酒店测评博主与旅行内容创作者准备的 AI 创作工具:上传实拍图片 + 输入测评心得,我们帮你生成符合小红书风格、视觉冲击力强的完整图文笔记 —— 封面、内页、标题、正文、话题标签、评论区引导,一次到位。
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/create">
                  <a
                    data-testid="button-start-create-hero"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium shadow-md hover:shadow-lg hover:opacity-95 transition"
                  >
                    <Sparkles className="size-4" />
                    开始创作
                  </a>
                </Link>
                <a
                  href="#how"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("how")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="inline-flex items-center px-5 py-3 rounded-full border border-border bg-card text-sm font-medium hover-elevate"
                  data-testid="button-scroll-how"
                >
                  看看怎么用
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground" data-testid="list-hero-bullets">
                <li className="flex items-center gap-2"><span className="size-1 rounded-full bg-primary/70" />支持 12+ 风格切换</li>
                <li className="flex items-center gap-2"><span className="size-1 rounded-full bg-primary/70" />仅使用你提供的素材</li>
                <li className="flex items-center gap-2"><span className="size-1 rounded-full bg-primary/70" />输出手机端所见即所得</li>
              </ul>
            </div>

            {/* PHONE PREVIEW MOCKUP */}
            <div className="md:col-span-5 flex justify-center md:justify-end" data-testid="image-hero-mockup">
              <HeroPhone />
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="border-t border-border/40 bg-background">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
          <div className="flex items-end justify-between flex-wrap gap-6">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Features</div>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">
                博主真正需要的,我们只做这些
              </h2>
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              不堆叠功能、不替你瞎编。NoteStay 的每个模块,都是为了让你的酒店笔记看起来像“你认真住过”的那种。
            </p>
          </div>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-card-border bg-card p-5 hover-elevate"
                data-testid={`card-feature-${f.title}`}
              >
                <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <f.icon className="size-4" />
                </div>
                <div className="mt-4 font-semibold">{f.title}</div>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">How it works</div>
          <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">三步,把这次入住记住</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border border-card-border bg-card p-6" data-testid={`card-step-${s.n}`}>
                <div className="text-xs font-mono tracking-widest text-primary">{s.n}</div>
                <div className="mt-2 text-lg font-semibold">{s.title}</div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STYLES */}
      <section className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Styles</div>
              <h2 className="mt-2 text-2xl md:text-3xl font-bold tracking-tight">12+ 种博主常用风格</h2>
            </div>
            <Link href="/create">
              <a
                className="text-sm text-primary font-medium hover:underline"
                data-testid="link-to-create-from-styles"
              >
                到创作页选风格 →
              </a>
            </Link>
          </div>

          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {STYLE_LIST.slice(0, 12).map((s) => (
              <div
                key={s.key}
                className="relative rounded-2xl overflow-hidden border border-card-border aspect-[3/4]"
                data-testid={`card-style-${s.key}`}
                style={{
                  background: `linear-gradient(150deg, ${s.palette[0]} 0%, ${s.palette[1]} 60%, ${s.palette[2]} 100%)`,
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-transparent" />
                <div className="absolute inset-0 p-4 flex flex-col justify-between text-white">
                  <div className="text-[10px] uppercase tracking-[0.2em] opacity-80">{s.english}</div>
                  <div>
                    <div className="text-lg font-bold drop-shadow-sm">{s.name}</div>
                    <p className="mt-1 text-[11px] opacity-90 leading-snug line-clamp-2">{s.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16 md:py-24">
          <div className="rounded-3xl brand-gradient-soft border border-card-border p-8 md:p-14 relative overflow-hidden">
            <div className="max-w-2xl">
              <h3 className="text-2xl md:text-4xl font-bold tracking-tight text-balance">
                把这次入住,变成一篇值得被收藏的笔记。
              </h3>
              <p className="mt-4 text-sm md:text-base text-muted-foreground whitespace-nowrap overflow-x-auto scroll-area-hide">
                现在打开,几分钟内你就能拿到一份小红书风格的完整图文笔记 —— 来自你自己的素材,不靠瞎编。
              </p>
              <div className="mt-6">
                <Link href="/create">
                  <a
                    data-testid="button-start-create-cta"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium shadow-md"
                  >
                    <Sparkles className="size-4" /> 开始创作
                  </a>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function HeroPhone() {
  return (
    <div
      className="relative w-[240px] md:w-[280px] aspect-[4/5] rounded-[2rem] bg-foreground/90 dark:bg-black p-2 shadow-2xl rotate-[2deg]"
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-[2rem] ring-1 ring-black/10" />
      <div className="relative h-full w-full rounded-[1.6rem] overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(155deg, #FFEDED 0%, #FFC2C2 35%, #E94B5A 75%, #8C2A35 100%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        <div className="relative h-full p-4 flex flex-col text-white">
          <div className="flex items-center justify-between text-[10px] opacity-80">
            <span>9:41</span>
            <span>● ● ●</span>
          </div>
          <div className="mt-auto">
            <div className="text-[10px] uppercase tracking-[0.22em] opacity-80">XHS Viral Cover</div>
            <div className="mt-1 text-2xl font-extrabold leading-tight">
              蹲到了!
              <br />
              这家酒店必须冲
            </div>
            <div className="mt-3 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/20 backdrop-blur text-[10px]">
              📍 由你的实拍生成
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-[10px] opacity-90">
            <span>❤️ 12.3k</span>
            <span>💬 482</span>
            <span>⭐ 收藏</span>
          </div>
        </div>
      </div>
    </div>
  );
}
