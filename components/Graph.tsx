"use client";

import { useEffect, useRef } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Relation } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Types & theme                                                      */
/* ------------------------------------------------------------------ */

export interface GraphNode {
  id: string;
  label: string;
  group: number;
  redacted?: boolean;
  mine?: boolean;
  match?: boolean; // search hit
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "student" | "keyword";
  relation?: Relation;
}

export interface GraphSettings {
  search: string;
  showStudent: boolean;
  showKeyword: boolean;
  minShared: number;
  ignorePrompt: boolean;
  colorBy: "pair" | "none";
  arrows: boolean;
  textFade: number; // 0–1: higher = labels appear only when zoomed further in
  nodeSize: number; // 0.5–2
  linkWidth: number; // 0.5–3
  centerForce: number; // 0–1
  repelForce: number; // 0–20
  linkForce: number; // 0–1
  linkDistance: number; // 30–300
}

export const DEFAULT_SETTINGS: GraphSettings = {
  search: "",
  showStudent: true,
  showKeyword: true,
  minShared: 1,
  ignorePrompt: true,
  colorBy: "pair",
  arrows: true,
  textFade: 0.4,
  nodeSize: 1,
  linkWidth: 1,
  centerForce: 0.35,
  repelForce: 12,
  linkForce: 0.6,
  linkDistance: 120,
};

export const GRAPH_THEME = {
  bg: "#0f1b33",
  bgEdge: "#0a1426",
  node: "#c9d4e8",
  redacted: "#51658f",
  label: "#eef2fa",
  keyword: "#8fa6cf",
  focus: "#FCD80C",
  mine: "#ffffff",
};

export const RELATION_COLORS: Record<Relation, string> = {
  builds: "#A8CC30",
  agrees: "#30B4B4",
  challenges: "#FCA83C",
  similar: "#FCD80C",
};

// NIS colours first, then extra distinct tints for bigger classes.
export const GROUP_PALETTE = [
  "#A8CC30",
  "#30B4B4",
  "#FCD80C",
  "#FCA83C",
  "#8EC5FF",
  "#F28CB1",
  "#D4A373",
  "#B39DFF",
  "#7EE0B5",
  "#FF8A7A",
  "#E2F08C",
  "#6FD3F2",
];

export const groupColor = (g: number) => GROUP_PALETTE[(g >= 1000 ? g - 1000 : g) % GROUP_PALETTE.length];

type SimNode = GraphNode & SimulationNodeDatum & { degree: number; born: number; r: number };
type SimEdge = Omit<GraphEdge, "source" | "target"> & SimulationLinkDatum<SimNode> & { source: SimNode; target: SimNode };

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  settings: GraphSettings;
  selectedId: string | null;
  linkFromId?: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
  /** Keep re-fitting the view as ideas arrive (projector mode). */
  autoFit?: boolean;
  /** Bigger labels for the projector. */
  labelScale?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function truncate(s: string, n: number) {
  const chars = Array.from(s.replace(/\s+/g, " "));
  return chars.length > n ? chars.slice(0, n - 1).join("").trimEnd() + "…" : chars.join("");
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function Graph({
  nodes,
  edges,
  settings,
  selectedId,
  linkFromId = null,
  onSelect,
  className,
  autoFit = true,
  labelScale = 1,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Everything the animation loop needs lives in one mutable object.
  const S = useRef({
    sim: null as Simulation<SimNode, SimEdge> | null,
    nodeMap: new Map<string, SimNode>(),
    nodes: [] as SimNode[],
    edges: [] as SimEdge[],
    w: 0,
    h: 0,
    dpr: 1,
    t: { x: 0, y: 0, k: 1 },
    fitting: true, // follow the auto-fit target until the user pans/zooms
    hoverId: null as string | null,
    focusT: 0, // 0..1 fade for hover/selection emphasis
    focusId: null as string | null,
    dirty: true,
    animUntil: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    drag: null as null | {
      mode: "node" | "pan" | "pinch";
      node?: SimNode;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      startTime: number;
      pinchDist?: number;
    },
    settings,
    selectedId,
    linkFromId,
    autoFit,
    labelScale,
    onSelect,
  });

  // Keep the latest props visible to the loop.
  S.current.settings = settings;
  S.current.selectedId = selectedId;
  S.current.linkFromId = linkFromId;
  S.current.onSelect = onSelect;
  S.current.autoFit = autoFit;
  S.current.labelScale = labelScale;
  S.current.dirty = true;

  /* ---------- simulation setup (once) ---------- */
  useEffect(() => {
    const s = S.current;
    const sim = forceSimulation<SimNode, SimEdge>([])
      .force("charge", forceManyBody<SimNode>())
      .force(
        "link",
        forceLink<SimNode, SimEdge>([]).id((d) => d.id),
      )
      .force("x", forceX<SimNode>(0))
      .force("y", forceY<SimNode>(0))
      .force("collide", forceCollide<SimNode>((d) => d.r + 14))
      .alphaDecay(0.02)
      .velocityDecay(0.35)
      .on("tick", () => {
        s.dirty = true;
      });
    s.sim = sim;
    return () => {
      sim.stop();
    };
  }, []);

  /* ---------- forces follow the sliders ---------- */
  useEffect(() => {
    const sim = S.current.sim;
    if (!sim) return;
    const st = settings;
    (sim.force("charge") as ReturnType<typeof forceManyBody<SimNode>>)
      .strength(-st.repelForce * 28)
      .distanceMax(900);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimEdge>>)
      .distance((e) => (e.kind === "student" ? st.linkDistance * 0.85 : st.linkDistance * 1.15))
      .strength((e) => {
        const base = e.kind === "student" ? 1 : 0.45;
        const deg = Math.min(e.source.degree, e.target.degree) || 1;
        return (st.linkForce * base) / Math.sqrt(deg);
      });
    (sim.force("x") as ReturnType<typeof forceX<SimNode>>).strength(st.centerForce * 0.12);
    (sim.force("y") as ReturnType<typeof forceY<SimNode>>).strength(st.centerForce * 0.12);
    for (const n of S.current.nodes) n.r = radius(n, st.nodeSize);
    (sim.force("collide") as ReturnType<typeof forceCollide<SimNode>>).radius((d) => d.r + 14);
    sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
  }, [settings.repelForce, settings.linkDistance, settings.linkForce, settings.centerForce, settings.nodeSize]);

  /* ---------- data → simulation (keeps positions) ---------- */
  useEffect(() => {
    const s = S.current;
    const sim = s.sim;
    if (!sim) return;
    const now = performance.now();
    const next = new Map<string, SimNode>();
    let structural = nodes.length !== s.nodes.length;

    // neighbour lookup for placing newcomers next to something they link to
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
      (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
    }

    for (const n of nodes) {
      const old = s.nodeMap.get(n.id);
      if (old) {
        Object.assign(old, n);
        next.set(n.id, old);
      } else {
        structural = true;
        const friend = (adj.get(n.id) ?? []).map((id) => s.nodeMap.get(id)).find(Boolean);
        const angle = Math.random() * Math.PI * 2;
        const dist = friend ? 30 : 60 + Math.random() * 80 + Math.sqrt(s.nodes.length) * 20;
        const ox = friend?.x ?? 0;
        const oy = friend?.y ?? 0;
        next.set(n.id, {
          ...n,
          x: ox + Math.cos(angle) * dist,
          y: oy + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          degree: 0,
          born: s.nodes.length === 0 ? now - 400 + Math.random() * 400 : now,
          r: 5,
        });
      }
    }

    const newEdges: SimEdge[] = [];
    for (const e of edges) {
      const a = next.get(e.source);
      const b = next.get(e.target);
      if (!a || !b) continue;
      newEdges.push({ ...e, source: a, target: b });
    }
    const oldKey = s.edges.map((e) => e.id).join(",");
    const newKey = newEdges.map((e) => e.id).join(",");
    if (oldKey !== newKey) structural = true;

    for (const n of next.values()) n.degree = 0;
    for (const e of newEdges) {
      e.source.degree++;
      e.target.degree++;
    }
    for (const n of next.values()) n.r = radius(n, s.settings.nodeSize);

    s.nodeMap = next;
    s.nodes = [...next.values()];
    s.edges = newEdges;
    sim.nodes(s.nodes);
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimEdge>>).links(newEdges);
    if (structural) {
      sim.alpha(Math.max(sim.alpha(), s.nodes.length < 3 ? 0.6 : 0.45)).restart();
      s.animUntil = now + 700;
    }
    s.dirty = true;
  }, [nodes, edges]);

  /* ---------- canvas, pointer input, render loop ---------- */
  useEffect(() => {
    const s = S.current;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      s.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      s.w = Math.max(50, rect.width);
      s.h = Math.max(50, rect.height);
      canvas.width = Math.round(s.w * s.dpr);
      canvas.height = Math.round(s.h * s.dpr);
      canvas.style.width = `${s.w}px`;
      canvas.style.height = `${s.h}px`;
      s.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const toWorld = (sx: number, sy: number) => ({
      x: (sx - s.w / 2 - s.t.x) / s.t.k,
      y: (sy - s.h / 2 - s.t.y) / s.t.k,
    });
    const local = (ev: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const hit = (sx: number, sy: number): SimNode | null => {
      const p = toWorld(sx, sy);
      let best: SimNode | null = null;
      let bestD = Infinity;
      const slop = 8 / s.t.k;
      for (const n of s.nodes) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d < n.r + slop && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };
    const zoomAt = (sx: number, sy: number, factor: number) => {
      const k = clamp(s.t.k * factor, 0.12, 6);
      const p = toWorld(sx, sy);
      s.t.k = k;
      s.t.x = sx - s.w / 2 - p.x * k;
      s.t.y = sy - s.h / 2 - p.y * k;
      s.fitting = false;
      s.dirty = true;
    };

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const p = local(ev);
      const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomAt(p.x, p.y, Math.exp(-delta * 0.0016));
    };

    const onDown = (ev: PointerEvent) => {
      canvas.setPointerCapture(ev.pointerId);
      const p = local(ev);
      s.pointers.set(ev.pointerId, p);
      if (s.pointers.size === 2) {
        // second finger: switch to pinch zoom
        const [a, b] = [...s.pointers.values()];
        if (s.drag?.node) releaseNode(s.drag.node);
        s.drag = {
          mode: "pinch",
          startX: (a.x + b.x) / 2,
          startY: (a.y + b.y) / 2,
          lastX: (a.x + b.x) / 2,
          lastY: (a.y + b.y) / 2,
          moved: true,
          startTime: Date.now(),
          pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
        };
        return;
      }
      const node = hit(p.x, p.y);
      s.drag = {
        mode: node ? "node" : "pan",
        node: node ?? undefined,
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        startTime: Date.now(),
      };
    };

    const releaseNode = (n: SimNode) => {
      n.fx = null;
      n.fy = null;
      s.sim?.alphaTarget(0);
    };

    const onMove = (ev: PointerEvent) => {
      const p = local(ev);
      if (s.pointers.has(ev.pointerId)) s.pointers.set(ev.pointerId, p);
      const d = s.drag;
      if (!d) {
        if (ev.pointerType === "mouse") {
          const n = hit(p.x, p.y);
          const id = n?.id ?? null;
          if (id !== s.hoverId) {
            s.hoverId = id;
            s.dirty = true;
            canvas.style.cursor = n ? "pointer" : "grab";
          }
        }
        return;
      }
      if (d.mode === "pinch") {
        const pts = [...s.pointers.values()];
        if (pts.length < 2) return;
        const [a, b] = pts;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        s.t.x += mid.x - d.lastX;
        s.t.y += mid.y - d.lastY;
        d.lastX = mid.x;
        d.lastY = mid.y;
        if (d.pinchDist) zoomAt(mid.x, mid.y, dist / d.pinchDist);
        d.pinchDist = dist;
        s.fitting = false;
        s.dirty = true;
        return;
      }
      if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) > 5) {
        d.moved = true;
        if (d.mode === "node" && d.node) {
          s.fitting = false; // don't move the camera under the user's finger
          d.node.fx = d.node.x;
          d.node.fy = d.node.y;
          s.sim?.alphaTarget(0.25).restart();
        }
        canvas.style.cursor = "grabbing";
      }
      if (!d.moved) return;
      if (d.mode === "node" && d.node) {
        const w = toWorld(p.x, p.y);
        d.node.fx = w.x;
        d.node.fy = w.y;
        s.hoverId = d.node.id;
      } else if (d.mode === "pan") {
        s.t.x += p.x - d.lastX;
        s.t.y += p.y - d.lastY;
        s.fitting = false;
      }
      d.lastX = p.x;
      d.lastY = p.y;
      s.dirty = true;
    };

    const onUp = (ev: PointerEvent) => {
      s.pointers.delete(ev.pointerId);
      const d = s.drag;
      if (!d) return;
      if (d.mode === "pinch") {
        if (s.pointers.size === 0) s.drag = null;
        return;
      }
      if (d.node && d.moved) releaseNode(d.node);
      if (!d.moved && Date.now() - d.startTime < 600) {
        s.onSelect(d.node ? d.node.id : null);
      }
      s.drag = null;
      canvas.style.cursor = s.hoverId ? "pointer" : "grab";
      if (ev.pointerType !== "mouse") s.hoverId = null;
      s.dirty = true;
    };

    const onLeave = () => {
      if (!s.drag && s.hoverId) {
        s.hoverId = null;
        s.dirty = true;
      }
    };

    const onDbl = (ev: MouseEvent) => {
      const p = local(ev);
      if (!hit(p.x, p.y)) {
        s.fitting = true;
        s.dirty = true;
      }
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDbl);
    canvas.style.cursor = "grab";

    // expose zoom controls to the overlay buttons
    (wrap as any).__graph = {
      zoom: (f: number) => zoomAt(s.w / 2, s.h / 2, f),
      fit: () => {
        s.fitting = true;
        s.dirty = true;
      },
      // screen positions of nodes (handy for automated tests)
      positions: () =>
        s.nodes.map((n) => ({
          id: n.id,
          x: (n.x ?? 0) * s.t.k + s.w / 2 + s.t.x,
          y: (n.y ?? 0) * s.t.k + s.h / 2 + s.t.y,
        })),
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();

      // ease the emphasis fade
      const focusId = s.hoverId ?? s.selectedId ?? null;
      if (focusId) s.focusId = focusId;
      const targetT = focusId ? 1 : 0;
      if (Math.abs(s.focusT - targetT) > 0.01) {
        s.focusT += (targetT - s.focusT) * 0.2;
        s.dirty = true;
      } else if (s.focusT !== targetT) {
        s.focusT = targetT;
        s.dirty = true;
      }

      // auto-fit
      if (s.fitting && s.autoFit !== false && s.nodes.length) {
        const target = fitTransform(s.nodes, s.w, s.h);
        const dx = target.x - s.t.x;
        const dy = target.y - s.t.y;
        const dk = target.k - s.t.k;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(dk) > 0.002) {
          s.t.x += dx * 0.12;
          s.t.y += dy * 0.12;
          s.t.k += dk * 0.12;
          s.dirty = true;
        }
      } else if (s.fitting && s.autoFit === false) {
        // manual fit request: go there once, then stop following
        const target = fitTransform(s.nodes, s.w, s.h);
        s.t.x += (target.x - s.t.x) * 0.2;
        s.t.y += (target.y - s.t.y) * 0.2;
        s.t.k += (target.k - s.t.k) * 0.2;
        s.dirty = true;
        if (Math.abs(target.k - s.t.k) < 0.003 && Math.abs(target.x - s.t.x) < 1) s.fitting = false;
      }

      if (now < s.animUntil) s.dirty = true;
      if (!s.dirty) return;
      s.dirty = false;
      draw(ctx, s, now);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDbl);
    };
  }, []);

  const ctl = (fn: "zoomIn" | "zoomOut" | "fit") => {
    const g = (wrapRef.current as any)?.__graph;
    if (!g) return;
    if (fn === "fit") g.fit();
    else g.zoom(fn === "zoomIn" ? 1.3 : 1 / 1.3);
  };

  return (
    <div ref={wrapRef} className={`graph-wrap ${className ?? ""}`}>
      <canvas ref={canvasRef} style={{ touchAction: "none", display: "block" }} aria-label="Idea graph" role="img" />
      <div className="graph-zoom">
        <button type="button" onClick={() => ctl("zoomIn")} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => ctl("zoomOut")} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => ctl("fit")} aria-label="Fit to screen" title="Fit (or double-click the background)">
          ⤢
        </button>
      </div>
      {nodes.length === 0 && <div className="graph-empty">Ideas will appear here as they arrive.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawing                                                            */
/* ------------------------------------------------------------------ */

function radius(n: { degree: number }, size: number) {
  return (5 + Math.sqrt(n.degree) * 2.6) * size;
}

function fitTransform(nodes: SimNode[], w: number, h: number) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    minX = Math.min(minX, x - n.r);
    maxX = Math.max(maxX, x + n.r);
    minY = Math.min(minY, y - n.r);
    maxY = Math.max(maxY, y + n.r);
  }
  // Screen-space margins: room for labels at the sides/bottom and the counts/word chips at the top.
  const padX = Math.min(130, w * 0.14);
  const padTop = Math.min(96, h * 0.2);
  const padBottom = Math.min(56, h * 0.12);
  const bw = Math.max(maxX - minX, 60);
  const bh = Math.max(maxY - minY, 60);
  const k = clamp(Math.min((w - padX * 2) / bw, (h - padTop - padBottom) / bh), 0.15, 1.5);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: -cx * k, y: -cy * k + (padTop - padBottom) / 2 };
}

function draw(ctx: CanvasRenderingContext2D, s: any, now: number) {
  const { w, h, dpr, t, settings } = s as {
    w: number;
    h: number;
    dpr: number;
    t: { x: number; y: number; k: number };
    settings: GraphSettings;
  };
  const nodes = s.nodes as SimNode[];
  const edges = s.edges as SimEdge[];

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // background: deep NIS navy with a soft centre glow
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, GRAPH_THEME.bg);
  g.addColorStop(1, GRAPH_THEME.bgEdge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.translate(w / 2 + t.x, h / 2 + t.y);
  ctx.scale(t.k, t.k);
  const k = t.k;

  const focusId: string | null = s.focusId;
  const fT: number = s.focusT;
  const neighbours = new Set<string>();
  if (focusId) {
    neighbours.add(focusId);
    for (const e of edges) {
      if (e.source.id === focusId) neighbours.add(e.target.id);
      if (e.target.id === focusId) neighbours.add(e.source.id);
    }
  }
  const searching = settings.search.trim().length > 0;
  const mix = (a: number, b: number) => a + (b - a) * fT;

  /* edges */
  for (const e of edges) {
    const touches = !!focusId && (e.source.id === focusId || e.target.id === focusId);
    const isKw = e.kind === "keyword";
    let alpha = isKw ? 0.3 : 0.7;
    alpha = mix(alpha, touches ? 1 : 0.05);
    if (searching && !(e.source.match && e.target.match)) alpha *= 0.3;
    const color = isKw ? GRAPH_THEME.keyword : RELATION_COLORS[e.relation ?? "builds"];
    const width = ((isKw ? 1 : 1.8) * settings.linkWidth * (touches ? 1.4 : 1)) / Math.sqrt(k);
    const sx = e.source.x ?? 0,
      sy = e.source.y ?? 0,
      tx = e.target.x ?? 0,
      ty = e.target.y ?? 0;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(isKw ? [4 / k, 4 / k] : []);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    if (!isKw && settings.arrows) {
      const ang = Math.atan2(ty - sy, tx - sx);
      const len = Math.hypot(tx - sx, ty - sy);
      if (len > e.target.r + 4) {
        const ax = tx - Math.cos(ang) * (e.target.r + 2);
        const ay = ty - Math.sin(ang) * (e.target.r + 2);
        const size = (6 * settings.linkWidth) / Math.sqrt(k) + 2;
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - Math.cos(ang - 0.45) * size, ay - Math.sin(ang - 0.45) * size);
        ctx.lineTo(ax - Math.cos(ang + 0.45) * size, ay - Math.sin(ang + 0.45) * size);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.setLineDash([]);

  /* nodes */
  const pulse = 0.5 + 0.5 * Math.sin(now / 500);
  let anyRedacted = false;
  for (const n of nodes) {
    const x = n.x ?? 0,
      y = n.y ?? 0;
    const age = clamp((now - n.born) / 550, 0, 1);
    const grow = age >= 1 ? 1 : Math.max(0.01, easeOutBack(age));
    const isFocus = n.id === focusId;
    const r = n.r * grow * (isFocus ? 1 + 0.25 * fT : 1);
    let alpha = mix(1, neighbours.has(n.id) ? 1 : 0.2);
    if (searching && !n.match) alpha *= 0.25;

    let fill = settings.colorBy === "pair" ? groupColor(n.group) : GRAPH_THEME.node;
    if (n.redacted) {
      fill = GRAPH_THEME.redacted;
      anyRedacted = true;
    }

    ctx.globalAlpha = alpha;
    // soft glow on new or focused nodes
    if (age < 1 || isFocus || (searching && n.match)) {
      ctx.fillStyle = fill;
      ctx.globalAlpha = alpha * (age < 1 ? (1 - age) * 0.5 : 0.25);
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (n.redacted) {
      ctx.globalAlpha = alpha * (0.25 + 0.35 * pulse);
      ctx.strokeStyle = "#9fb3d9";
      ctx.lineWidth = 1.5 / k;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    const ring = n.id === s.linkFromId ? "#ffffff" : n.id === s.selectedId ? GRAPH_THEME.focus : n.mine ? GRAPH_THEME.mine : null;
    if (ring) {
      ctx.strokeStyle = ring;
      ctx.lineWidth = (n.id === s.selectedId || n.id === s.linkFromId ? 2.5 : 1.5) / Math.sqrt(k);
      if (n.id === s.linkFromId) ctx.setLineDash([3 / k, 3 / k]);
      ctx.beginPath();
      ctx.arc(x, y, r + 3 / Math.sqrt(k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (anyRedacted) s.dirty = true; // keep the pulse going

  /* labels — fade in as you zoom, like Obsidian */
  const small = w < 600;
  const fadeStart = (0.35 + settings.textFade * 1.3) * (small ? 0.6 : 1);
  const zoomAlpha = clamp((k - fadeStart) / 0.35, 0, 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  // focused label last so it sits on top of its neighbours' labels
  const labelOrder = focusId
    ? [...nodes].sort((a, b) => rank(a) - rank(b))
    : nodes;
  function rank(n: SimNode) {
    return n.id === focusId ? 2 : neighbours.has(n.id) ? 1 : 0;
  }
  for (const n of labelOrder) {
    if (n.redacted || !n.label) continue;
    const emph = neighbours.has(n.id) && fT > 0.05;
    const matched = searching && n.match;
    let a = zoomAlpha;
    if (emph) a = Math.max(a, fT * (n.id === focusId ? 1 : 0.9));
    else if (focusId) a *= mix(1, 0.15);
    if (matched) a = Math.max(a, 0.9);
    if (searching && !n.match) a *= 0.25;
    if (a < 0.02) continue;
    const age = clamp((now - n.born) / 550, 0, 1);
    a *= age;
    const px = (n.id === focusId ? 13 : 11.5) * (small ? 0.95 : 1) * (s.labelScale ?? 1);
    const screenPx = px * clamp(Math.sqrt(k), 1, 1.3); // grows a little when zoomed in, never shrinks
    const size = screenPx / k;
    ctx.font = `${n.id === focusId ? 600 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const text = truncate(n.label, n.id === focusId ? (small ? 36 : 60) : small ? 22 : 34);
    const y = (n.y ?? 0) + n.r + 4 / k;
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(10,20,38,0.92)";
    ctx.lineWidth = 3.5 / k;
    ctx.strokeText(text, n.x ?? 0, y);
    ctx.fillStyle = GRAPH_THEME.label;
    ctx.fillText(text, n.x ?? 0, y);
  }
  ctx.globalAlpha = 1;
}
