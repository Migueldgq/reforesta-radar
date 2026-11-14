"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Runs once per page: reveals `[data-reveal]` / `[data-stagger]` blocks as they enter the
 * viewport and flags the document once scrolled (for the nav). Content is visible by default:
 * hidden "before" states only apply under `html.lp-ready`, set here after hydration, so the
 * page stays fully visible without JS. Below-the-fold blocks are the only ones it rewinds.
 */
export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("lp-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    const watch = () =>
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in), [data-stagger]:not(.is-in)").forEach((el) => {
        if (el.hasAttribute("data-stagger"))
          Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(Math.min(i, 8))));
        io.observe(el);
      });
    watch();
    // Streamed (Suspense) content arrives after mount.
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        root.toggleAttribute("data-lp-scrolled", window.scrollY > 8);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      root.removeAttribute("data-lp-scrolled");
      root.classList.remove("lp-ready");
    };
  }, []);
  return null;
}

const nf = new Intl.NumberFormat("es-ES");

/**
 * Counts up to `value` the first time it scrolls into view. Server HTML and no-JS show the
 * final value; width is reserved with tabular figures so nothing shifts.
 */
export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const dur = 1100;
        const tick = (t: number) => {
          const p = Math.min(1, (t - start) / dur);
          setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setShown(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  const final = nf.format(value) + suffix;
  return (
    <span ref={ref} className={className} style={{ display: "inline-block", minWidth: `${final.length}ch`, fontVariantNumeric: "tabular-nums" }}>
      <span aria-hidden>{nf.format(shown) + suffix}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
