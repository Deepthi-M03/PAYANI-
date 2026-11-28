/**
 * PAYANI identity. The symbol is a single journey: a line leaves an origin (the ring at the
 * foot), climbs, and loops round to arrive at a destination (the saffron node), drawing a "P".
 * Original artwork; see docs/brand.md for construction and clear-space rules.
 */
import { useId } from "react";

export const MARK_PATH = "M15 41V17.5a9.5 9.5 0 0 1 9.5-9.5h4a10.5 10.5 0 0 1 0 21H24";

type Tone = "light" | "dark";

/** The symbol alone. `animated` draws the route, then lands the destination node. */
export function LogoMark({ size = 32, tone = "dark", animated = false, className = "" }: { size?: number; tone?: Tone; animated?: boolean; className?: string }) {
  const line = tone === "dark" ? "var(--color-navy)" : "#ffffff";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={className} data-animated={animated || undefined}>
      <path d={MARK_PATH} fill="none" stroke={line} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" pathLength={1}
            className={animated ? "[stroke-dasharray:1] motion-safe:animate-[route-draw_900ms_var(--ease-ui)_both]" : undefined} />
      <circle cx="15" cy="41" r="3.4" fill={tone === "dark" ? "#ffffff" : "var(--color-navy)"} stroke={line} strokeWidth="2.4" />
      <circle cx="24" cy="29" r="4.6" fill="var(--color-saffron)"
              className={animated ? "origin-[24px_29px] motion-safe:animate-[node-land_420ms_var(--ease-ui)_760ms_both]" : undefined} />
    </svg>
  );
}

/** Symbol + wordmark. The wordmark is set in IBM Plex Sans SemiBold with open tracking. */
export function Logo({ tone = "dark", size = 30, animated = false, showTagline = false }: { tone?: Tone; size?: number; animated?: boolean; showTagline?: boolean }) {
  const id = useId();
  const letters = "PAYANI".split("");
  return (
    <span className={`inline-flex items-center gap-2.5 ${tone === "dark" ? "text-navy" : "text-white"}`} aria-labelledby={id} role="img">
      <span id={id} className="sr-only">PAYANI</span>
      <LogoMark size={size} tone={tone} animated={animated} />
      <span aria-hidden className="flex flex-col leading-none">
        <span className="flex text-[1.06rem] font-semibold tracking-[0.2em]">
          {letters.map((l, i) => (
            <span key={i} className={animated ? "motion-safe:animate-[letter-in_520ms_var(--ease-ui)_both]" : undefined}
                  style={animated ? { animationDelay: `${380 + i * 55}ms` } : undefined}>{l}</span>
          ))}
        </span>
        {showTagline && <span className={`mt-1 text-[0.62rem] font-medium tracking-[0.08em] ${tone === "dark" ? "text-muted" : "text-white/60"}`}>Travel together</span>}
      </span>
    </span>
  );
}
