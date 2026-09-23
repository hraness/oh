"use client";

import { useEffect, useRef } from "react";

// A culture of record organisms drifting behind the hero. Each amoeba carries
// a real record kind or store operation with a typed signature; they are
// blurred at rest, periodically surface into focus on their own rhythm,
// sharpen under the cursor like a microscope lens, and bud a derived record
// on click. Decorative only — pointer-events:none and aria-hidden.
const KINDS = [
  ["inquiry", "question → scope", "a"],
  ["evidence", "locator → support", "a"],
  ["view", "records → brief", "a"],
  ["verify", "ops → ok", "a"],
  ["entity", "source → identity", "b"],
  ["edition", "capture → bytes", "b"],
  ["digest", "bytes → sha256", "b"],
  ["projection", "log → derived", "b"],
  ["statement", "claim → stance", "c"],
  ["op", "idempotent → log", "c"],
  ["space", "records → graph", "c"],
  ["head", "generation → sha", "c"],
] as const;

interface Organism {
  el: HTMLDivElement; x: number; y: number; vx: number; vy: number;
  w: number; h: number; dir: number; size: number; focus: number;
  pulsePhase: number; pulseSpeed: number; ttl: number; born: number;
}

export function OhField() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const field = ref.current;
    const host = field?.parentElement;
    if (!field || !host || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const organisms: Organism[] = [];
    const make = (tag: readonly [string, string, string], x: number, y: number, ttl = Infinity): Organism => {
      const el = document.createElement("div");
      el.className = `oh-organism oo-${tag[2]}`;
      el.innerHTML = `<span class="oh-tag"><b>${tag[0]}</b><i>${tag[1]}</i></span>`;
      el.style.setProperty("--oo-dur", `${rand(6.5, 12).toFixed(1)}s`);
      field.appendChild(el);
      const dir = rand(0, Math.PI * 2);
      const speed = rand(3.5, 9);
      return {
        el, x, y, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed,
        w: el.offsetWidth, h: el.offsetHeight, dir, size: rand(0.82, 1.08),
        focus: 0, pulsePhase: rand(0, 40), pulseSpeed: rand(0.05, 0.13), ttl, born: performance.now(),
      };
    };

    let W = host.clientWidth, H = host.clientHeight;
    const count = Math.max(6, Math.min(13, Math.round((W * H) / 70000)));
    for (let i = 0; i < count; i++) organisms.push(make(KINDS[i % KINDS.length]!, rand(-20, W), rand(-10, H)));

    let mouseX = -1e4, mouseY = -1e4;
    const onMove = (event: PointerEvent) => {
      const r = field.getBoundingClientRect();
      mouseX = event.clientX - r.left;
      mouseY = event.clientY - r.top;
    };
    const onLeave = () => { mouseX = mouseY = -1e4; };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    // Derivation: click near a record and it buds a daughter that drifts off —
    // the projection metaphor, made literal.
    const onClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("a,button,summary")) return;
      const r = field.getBoundingClientRect();
      const cx = event.clientX - r.left, cy = event.clientY - r.top;
      let best: Organism | undefined, bestDist = 170;
      for (const o of organisms) {
        const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
        if (d < bestDist) { bestDist = d; best = o; }
      }
      if (!best) return;
      best.focus = 1;
      best.el.classList.remove("oo-pop");
      void best.el.offsetWidth;
      best.el.classList.add("oo-pop");
      if (organisms.filter(o => o.ttl !== Infinity).length >= 5) return;
      const tag = KINDS[Math.floor(Math.random() * KINDS.length)]!;
      const daughter = make(tag, best.x + best.w / 2, best.y + best.h / 2, 5200);
      daughter.el.classList.add("oo-daughter");
      daughter.vx = rand(-16, 16);
      daughter.vy = rand(-16, 16);
      daughter.focus = 0.9;
      organisms.push(daughter);
    };
    host.addEventListener("click", onClick);

    let last = performance.now(), raf = 0, running = false;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      for (let i = organisms.length - 1; i >= 0; i--) {
        const o = organisms[i]!;
        o.dir += (Math.sin(t * 0.4 + o.pulsePhase) * 0.6 + rand(-0.5, 0.5)) * dt;
        const sp = Math.hypot(o.vx, o.vy);
        o.vx = Math.cos(o.dir) * sp;
        o.vy = Math.sin(o.dir) * sp;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        const m = o.w * 0.55;
        if (o.x < -m) o.x = W - o.w + m; else if (o.x > W - o.w + m) o.x = -m;
        if (o.y < -m) o.y = H - o.h + m; else if (o.y > H - o.h + m) o.y = -m;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const dx = mouseX - cx, dy = mouseY - cy;
        const md = Math.hypot(dx, dy);
        if (md > 55 && md < 260) {
          let diff = Math.atan2(dy, dx) - o.dir;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          o.dir += diff * Math.min(1, (1 - md / 260) * 2.4 * dt);
        }
        const mFocus = md < 115 ? 1 : Math.max(0, 1 - (md - 115) / 190);
        const pulse = Math.max(0, Math.sin(t * o.pulseSpeed * Math.PI * 2 + o.pulsePhase) - 0.84) / 0.16;
        const target = Math.min(1, mFocus + pulse);
        o.focus += (target - o.focus) * Math.min(1, dt * 6);
        if (o.ttl !== Infinity) {
          const left = o.born + o.ttl - now;
          if (left < 0) { o.el.remove(); organisms.splice(i, 1); continue; }
          if (left < 1000) o.el.style.opacity = `${(left / 1000) * 0.6}`;
        }
        o.el.style.transform = `translate3d(${o.x}px, ${o.y}px, 0) scale(${(o.size + o.focus * 0.09).toFixed(3)})`;
        o.el.style.setProperty("--oo-focus", o.focus.toFixed(3));
      }
      if (running) raf = requestAnimationFrame(tick);
    };
    const start = () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); } };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    const observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
    observer.observe(field);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    const resize = new ResizeObserver(() => { W = host.clientWidth; H = host.clientHeight; });
    resize.observe(host);

    return () => {
      stop();
      observer.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
      for (const o of organisms) o.el.remove();
    };
  }, []);

  return <div ref={ref} className="oh-field" aria-hidden="true" />;
}
