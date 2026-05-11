import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import { BrandLogo } from "./brand-logo";

const NAV = [
  { href: "/", label: "首页" },
  { href: "/create", label: "创作" },
  { href: "/result", label: "结果" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-30 backdrop-blur-md bg-background/80 border-b border-border/60"
        data-testid="header-main"
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <Link href="/" data-testid="link-home">
            <a className="flex items-center" aria-label="返回首页">
              <BrandLogo size={32} />
            </a>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm" aria-label="主导航">
            {NAV.map((n) => {
              const active = location === n.href || (n.href !== "/" && location.startsWith(n.href));
              return (
                <Link key={n.href} href={n.href}>
                  <a
                    data-testid={`link-nav-${n.href.replace("/", "") || "home"}`}
                    className={`px-3 py-1.5 rounded-full transition-colors ${
                      active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {n.label}
                  </a>
                </Link>
              );
            })}
          </nav>
          <Link href="/create">
            <a
              data-testid="button-start-create-header"
              className="hidden md:inline-flex items-center px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-95 transition"
            >
              开始创作
            </a>
          </Link>
        </div>
        {/* Mobile bottom nav alternative — keep header inline tabs */}
        <div className="md:hidden border-t border-border/40 px-3 py-2 flex items-center gap-1 overflow-x-auto scroll-area-hide">
          {NAV.map((n) => {
            const active = location === n.href || (n.href !== "/" && location.startsWith(n.href));
            return (
              <Link key={n.href} href={n.href}>
                <a
                  data-testid={`link-mnav-${n.href.replace("/", "") || "home"}`}
                  className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition-colors ${
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {n.label}
                </a>
              </Link>
            );
          })}
        </div>
      </header>

      <main className="flex-1 w-full">{children}</main>

      <footer className="border-t border-border/60 mt-16">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 flex flex-col md:flex-row gap-4 md:gap-8 items-start md:items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <BrandLogo size={26} showWordmark={false} />
            <div>
              <div className="font-medium text-foreground">记住 · NoteStay</div>
              <div>酒店美好,一键记住</div>
            </div>
          </div>
          <div className="leading-relaxed">
            本工具为内容创作辅助工具,生成内容基于用户提供的素材与文字,
            <br className="hidden md:block" />
            不会编造未提供的价格、设施与体验细节。
          </div>
        </div>
      </footer>
    </div>
  );
}
