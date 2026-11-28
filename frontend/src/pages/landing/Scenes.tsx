/**
 * Original poster-style landscapes for the storytelling section, drawn in the Express Navy
 * palette. Each scene is layered (sky, far ridges, near ground, railway) so the layers can drift
 * at different speeds as the page scrolls. A licensed photograph can replace a scene by passing
 * `photo` (add its credit to docs/attribution.md).
 */
import type { ReactNode } from "react";

import { useParallax } from "../../motion/reveal";

export type SceneKind = "coast" | "ghats" | "plains";

/** Deterministic ridge line across the width, for organic-looking hills without random output. */
function ridge(seed: number, base: number, amp: number, w = 800, step = 20) {
  let d = `M0 500 L0 ${base}`;
  for (let x = 0; x <= w; x += step) {
    const y = base - amp * (0.55 * Math.sin((x + seed * 97) / 83) + 0.3 * Math.sin((x + seed * 41) / 37) + 0.15 * Math.sin((x + seed * 13) / 17));
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d + ` L${w} 500 Z`;
}

const SKIES: Record<SceneKind, [string, string, string]> = {
  coast: ["#0b1f3a", "#2d4f7f", "#f2a43a"],
  ghats: ["#12294a", "#3a5f86", "#c9d6e3"],
  plains: ["#0b1f3a", "#4a4f7a", "#f0b26a"],
};

function Layer({ speed, children, className = "" }: { speed: number; children: ReactNode; className?: string }) {
  const ref = useParallax<HTMLDivElement>(speed);
  return <div ref={ref} className={`absolute inset-x-0 -bottom-6 top-0 will-change-transform ${className}`}>{children}</div>;
}

const svg = (children: ReactNode) => <svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMax slice" className="h-full w-full" aria-hidden>{children}</svg>;

export function Scene({ kind, photo, alt }: { kind: SceneKind; photo?: string; alt: string }) {
  const [top, mid, glow] = SKIES[kind];
  if (photo) return <img src={photo} alt={alt} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />;
  return (
    <div role="img" aria-label={alt} className="absolute inset-0 overflow-hidden" style={{ background: `linear-gradient(180deg, ${top} 0%, ${mid} 58%, ${glow} 100%)` }}>
      <Layer speed={0.02}>{svg(<>
        <circle cx={kind === "ghats" ? 610 : 560} cy={kind === "plains" ? 300 : 270} r={kind === "ghats" ? 34 : 46} fill={kind === "ghats" ? "#ffffff" : "#f6c27a"} opacity={kind === "ghats" ? 0.35 : 0.9} />
        {kind === "ghats" && [0, 1, 2].map((i) => <rect key={i} x={-40 + i * 60} y={250 + i * 34} width="900" height="10" rx="5" fill="#ffffff" opacity={0.12} />)}
      </>)}</Layer>
      <Layer speed={0.05}>{svg(<path d={ridge(kind === "coast" ? 3 : kind === "ghats" ? 7 : 11, kind === "plains" ? 380 : 330, kind === "plains" ? 14 : 60)} fill={kind === "ghats" ? "#4f6f93" : "#2a4670"} opacity="0.85" />)}</Layer>
      <Layer speed={0.09}>{svg(<path d={ridge(kind === "coast" ? 5 : kind === "ghats" ? 2 : 17, kind === "plains" ? 410 : 385, kind === "plains" ? 8 : 42)} fill={kind === "ghats" ? "#2a4a6f" : "#1b3760"} />)}</Layer>
      <Layer speed={0.14}>{svg(<>
        {kind === "coast" && <><rect x="0" y="430" width="800" height="70" fill="#163d6e" /><path d="M0 438 H800" stroke="#f6c27a" strokeOpacity="0.35" strokeWidth="2" /></>}
        <path d={ridge(kind === "coast" ? 9 : kind === "ghats" ? 4 : 23, 452, kind === "plains" ? 4 : 18)} fill="#0b1f3a" />
        {kind === "ghats" && <path d="M150 470V425M230 470V424M310 470V423M390 470V422M470 470V421" stroke="#0b1f3a" strokeWidth="9" />}
        <path d="M-10 424 C200 418 420 414 820 404" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2.5" fill="none" />
        <path d="M-10 430 C200 424 420 420 820 410" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
        <g className="scene-train">
          <rect x="300" y="403" width="190" height="14" rx="7" fill="#ffffff" />
          <rect x="300" y="408" width="190" height="3" fill="#16335c" />
          <circle cx="484" cy="410" r="2.4" fill="#e8731a" />
        </g>
      </>)}</Layer>
    </div>
  );
}
