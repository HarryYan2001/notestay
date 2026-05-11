interface BrandLogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

/**
 * NoteStay / 记住 — custom brand mark.
 * The mark is an open "book / page" silhouette folded into a stylised "N",
 * paired with a small dot acting as a memory pin. Works as a pure SVG icon
 * at any size; the optional wordmark adds the Chinese + English brand block.
 */
export function BrandLogo({ size = 36, showWordmark = true, className }: BrandLogoProps) {
  return (
    <div
      className={`flex items-center gap-2.5 ${className ?? ""}`}
      data-testid="brand-logo"
      aria-label="记住 NoteStay"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Rounded coral square */}
        <rect width="48" height="48" rx="13" fill="hsl(358 78% 58%)" />
        {/* Folded page / N stroke */}
        <path
          d="M14 35 V13 h4.4 l11.2 14.6 V13 H34 v22 h-4.4 L18.4 20.6 V35 z"
          fill="white"
        />
        {/* Memory pin dot */}
        <circle cx="36.5" cy="13.5" r="2.4" fill="hsl(14 92% 78%)" />
      </svg>

      {showWordmark && (
        <div className="leading-none">
          <div className="text-base font-bold tracking-tight" data-testid="text-brand-cn">
            记住
            <span className="ml-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground align-middle">
              NoteStay
            </span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground tracking-wide">
            酒店美好,一键记住
          </div>
        </div>
      )}
    </div>
  );
}
