/**
 * Scroll-triggered reveals and gentle parallax with native APIs (IntersectionObserver,
 * requestAnimationFrame): no scroll hijacking, nothing runs off-screen, and with
 * prefers-reduced-motion everything is simply shown. Content is never hidden before JS runs.
 */
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/** True when the user asked for less motion (or the environment cannot tell, e.g. tests). */
export const prefersReducedMotion = () =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const reduced = prefersReducedMotion;

export function Reveal({ children, delay = 0, y = 18, className = "", as = "div", id }: {
  children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "section" | "li" | "article" | "header"; id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !("IntersectionObserver" in window)) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) return; // already on screen: show immediately
    el.dataset.reveal = "pending";
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { el.dataset.reveal = "shown"; io.disconnect(); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return createElement(as, { ref, id, className: `reveal ${className}`, style: { "--reveal-delay": `${delay}ms`, "--reveal-y": `${y}px` } as CSSProperties }, children);
}

/** Moves an element at `speed` × the scroll offset of its section (e.g. 0.12). */
export function useParallax<T extends HTMLElement>(speed = 0.12) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.parentElement?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) return;
      el.style.transform = `translate3d(0, ${(-r.top * speed).toFixed(1)}px, 0)`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [speed]);
  return ref;
}
