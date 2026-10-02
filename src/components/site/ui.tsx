// Shared building blocks for the public pages: page hero, action-type chips, empty states,
// skeletons and scroll reveal. Colors follow the office rooms (trading green, SOL Pit cyan,
// Narrative Lab violet, Research blue, Lounge amber).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AvatarRenderer } from "@/components/arena/AvatarRenderer";
import { typeStyle } from "@/lib/arena/type-style";

/** Small colored label for an action type. */
export function TypeChip({ type, className }: { type: string; className?: string }) {
  const s = typeStyle(type);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        className,
      )}
      style={{
        color: s.color,
        borderColor: `${s.color}55`,
        background: `${s.color}14`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

/** Pulsing "live" dot. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-fire opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-fire" />
    </span>
  );
}

/** Top-of-page title block: eyebrow, big title, subtitle and an optional side slot. */
export function PageHero({
  eyebrow,
  title,
  children,
  aside,
  live = false,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <Reveal className="min-w-0">
        <div className="inline-flex items-center gap-2 rounded-full border border-fire/30 bg-fire/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-fire">
          {live ? <LiveDot /> : <span className="size-1.5 rounded-full bg-fire" />}
          {eyebrow}
        </div>
        <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          {title}
        </h1>
        {children && (
          <div className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {children}
          </div>
        )}
      </Reveal>
      {aside && <div className="shrink-0">{aside}</div>}
    </header>
  );
}

/** Card surface used across pages. */
export function Panel({
  className,
  children,
  glow,
}: {
  className?: string;
  children: ReactNode;
  glow?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-card/70 backdrop-blur-sm",
        className,
      )}
      style={glow ? { boxShadow: `0 0 0 1px ${glow}22, 0 18px 50px -24px ${glow}55` } : undefined}
    >
      {children}
    </div>
  );
}

const CROWD = ["demo-Pip", "demo-Nova", "demo-Bolt", "demo-Mochi", "demo-Rune"];

/** Friendly empty state with a small crowd of agents. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Panel className="px-6 py-12 text-center">
      <div className="mx-auto flex w-fit -space-x-2">
        {CROWD.map((seed, i) => (
          <span
            key={seed}
            className="float-y inline-block rounded-full bg-background/80 p-1 ring-1 ring-border"
            style={{ "--float-delay": `${i * 180}ms` } as CSSProperties}
          >
            <AvatarRenderer seed={seed} size={40} />
          </span>
        ))}
      </div>
      <h3 className="mt-5 font-display text-lg font-bold">{title}</h3>
      {children && (
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Panel>
  );
}

/** Placeholder rows while data loads. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-4"
        >
          <div className="size-10 animate-pulse rounded-full bg-elevated" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 animate-pulse rounded bg-elevated" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-elevated/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fades and lifts its children in once they scroll into view. */
export function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={cn("reveal", shown && "is-shown", className)}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
