import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Eraser, Trash2 } from "lucide-react";
import {
  ERASER_RADIUS,
  WRITING_COLORS,
  WRITING_TOOL_ORDER,
  WriteGestureMachine,
  eraseFromStrokes,
  toolColor,
  type ActiveWritingTool,
  type WritingPoint,
  type WritingStroke,
  type WritingTool,
} from "@/lib/writing";

/** A fingertip sample pushed in from the hand-tracking loop, in slide space. */
export type WriteTick = (point: WritingPoint | null) => void;

type SlideRect = { x: number; y: number; w: number; h: number };

type Props = {
  /** Committed strokes for the slide on screen — the persisted source of truth. */
  strokes: WritingStroke[];
  /** Which slide these strokes belong to; a change resets the gesture machine. */
  slideIndex: number;
  /** The tool that is armed right now. */
  tool: ActiveWritingTool;
  /** Filled by this layer so the camera loop can forward fingertip samples. */
  tickRef: MutableRefObject<WriteTick | null>;
  onSelectTool: (tool: ActiveWritingTool) => void;
  onClearAll: () => void;
  onCommitStroke: (stroke: WritingStroke) => void;
  onErase: (point: WritingPoint) => void;
};

/** Paints one stroke with midpoint-quadratic smoothing so lines never look faceted. */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: WritingStroke,
  width: number,
  height: number,
): void {
  const pts = stroke.points;
  if (pts.length === 0) return;
  const lineWidth = Math.max(2.2, height * 0.0075);
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const first = pts[0];
  if (!first) return;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x * width, first.y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);
  for (let i = 1; i < pts.length - 1; i += 1) {
    const c = pts[i];
    const n = pts[i + 1];
    if (!c || !n) continue;
    ctx.quadraticCurveTo(c.x * width, c.y * height, ((c.x + n.x) / 2) * width, ((c.y + n.y) / 2) * height);
  }
  const last = pts[pts.length - 1];
  if (last) ctx.lineTo(last.x * width, last.y * height);
  ctx.stroke();
}

export function WritingLayer({
  strokes,
  slideIndex,
  tool,
  tickRef,
  onSelectTool,
  onClearAll,
  onCommitStroke,
  onErase,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteBoxRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const toolButtonRefs = useRef(new Map<WritingTool, HTMLButtonElement>());
  const dwellRingRef = useRef<SVGCircleElement | null>(null);

  const machineRef = useRef(new WriteGestureMachine());
  const liveRef = useRef<WritingStroke | null>(null);
  const strokesRef = useRef<WritingStroke[]>(strokes);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const toolRectsRef = useRef(new Map<WritingTool, SlideRect>());
  const paletteRectRef = useRef<SlideRect | null>(null);
  const idRef = useRef(0);

  const paletteOpenRef = useRef(false);
  const hoveredRef = useRef<WritingTool | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hovered, setHovered] = useState<WritingTool | null>(null);

  // Latest callbacks/props reached through refs so the tick closure stays stable.
  const onSelectToolRef = useRef(onSelectTool);
  const onClearAllRef = useRef(onClearAll);
  const onCommitStrokeRef = useRef(onCommitStroke);
  const onEraseRef = useRef(onErase);
  const toolRef = useRef<ActiveWritingTool>(tool);
  onSelectToolRef.current = onSelectTool;
  onClearAllRef.current = onClearAll;
  onCommitStrokeRef.current = onCommitStroke;
  onEraseRef.current = onErase;
  toolRef.current = tool;

  const nextId = useCallback(() => {
    idRef.current += 1;
    return `w${idRef.current}`;
  }, []);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, w, h);
    if (liveRef.current) drawStroke(ctx, liveRef.current, w, h);
  }, []);

  // Size the canvas to the rendered slide box (survives scaling and fullscreen).
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      measurePalette();
      repaint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repaint]);

  // Cache the palette geometry in slide space (0..1) for fingertip hit-testing.
  function measurePalette(): void {
    const root = rootRef.current;
    const box = paletteBoxRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width === 0 || rootRect.height === 0) return;
    const toSlide = (r: DOMRect): SlideRect => ({
      x: (r.left - rootRect.left) / rootRect.width,
      y: (r.top - rootRect.top) / rootRect.height,
      w: r.width / rootRect.width,
      h: r.height / rootRect.height,
    });
    paletteRectRef.current = box ? toSlide(box.getBoundingClientRect()) : null;
    const rects = new Map<WritingTool, SlideRect>();
    toolButtonRefs.current.forEach((btn, key) => rects.set(key, toSlide(btn.getBoundingClientRect())));
    toolRectsRef.current = rects;
  }

  // Keep the local mirror in step with the persisted strokes (slide switches,
  // clears and erases all flow through here) and repaint.
  useEffect(() => {
    strokesRef.current = strokes;
    repaint();
  }, [strokes, repaint]);

  // A new slide starts with a clean slate: drop any half-formed gesture.
  useEffect(() => {
    machineRef.current.reset();
    liveRef.current = null;
    paletteOpenRef.current = false;
    hoveredRef.current = null;
    setPaletteOpen(false);
    setHovered(null);
    if (cursorRef.current) cursorRef.current.style.display = "none";
    repaint();
  }, [slideIndex, repaint]);

  // Re-measure whenever the palette opens, since the buttons have just mounted.
  useEffect(() => {
    if (paletteOpen) measurePalette();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen]);

  function commitLiveStroke(): void {
    const stroke = liveRef.current;
    liveRef.current = null;
    if (stroke && stroke.points.length > 0) {
      strokesRef.current = [...strokesRef.current, stroke];
      onCommitStrokeRef.current(stroke);
    }
  }

  function applyErase(point: WritingPoint): void {
    const current = strokesRef.current;
    const next = eraseFromStrokes(current, point, ERASER_RADIUS, nextId);
    if (next !== current) {
      strokesRef.current = next;
      onEraseRef.current(point);
    }
  }

  function updateCursor(point: WritingPoint | null): void {
    const el = cursorRef.current;
    if (!el) return;
    if (!point) {
      el.style.display = "none";
      return;
    }
    const erasing = toolRef.current === "manual-eraser";
    const size = erasing ? ERASER_RADIUS * 2 * sizeRef.current.w : 16;
    el.style.display = "block";
    el.style.left = `${point.x * 100}%`;
    el.style.top = `${point.y * 100}%`;
    el.style.width = `${Math.max(14, size)}px`;
    el.style.height = `${Math.max(14, size)}px`;
    el.style.borderColor = erasing ? "rgba(255,255,255,0.9)" : toolColor(toolRef.current);
  }

  function updateDwellRing(dwell: number): void {
    const ring = dwellRingRef.current;
    if (!ring) return;
    const circumference = 2 * Math.PI * 15.5;
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, dwell)))}`;
  }

  const tick = useCallback<WriteTick>((point) => {
    const now = performance.now();

    // Fingertip → palette hit-test, only while the palette is on screen.
    let overPalette = false;
    let hit: WritingTool | null = null;
    if (paletteOpenRef.current && point) {
      const box = paletteRectRef.current;
      if (box) {
        const pad = 0.012;
        overPalette =
          point.x >= box.x - pad &&
          point.x <= box.x + box.w + pad &&
          point.y >= box.y - pad &&
          point.y <= box.y + box.h + pad;
      }
      if (overPalette) {
        const pad = 0.006;
        for (const [candidate, r] of toolRectsRef.current) {
          if (
            point.x >= r.x - pad &&
            point.x <= r.x + r.w + pad &&
            point.y >= r.y - pad &&
            point.y <= r.y + r.h + pad
          ) {
            hit = candidate;
            break;
          }
        }
      }
    }

    const frame = machineRef.current.update({
      point,
      overPalette,
      hit,
      tool: toolRef.current,
      now,
    });

    for (const effect of frame.effects) {
      switch (effect.kind) {
        case "begin":
          liveRef.current = { id: nextId(), color: toolColor(toolRef.current), points: [effect.point] };
          break;
        case "extend":
          liveRef.current?.points.push(effect.point);
          break;
        case "end":
          commitLiveStroke();
          break;
        case "erase":
          applyErase(effect.point);
          break;
        case "select":
          onSelectToolRef.current(effect.tool);
          break;
        case "clear":
          onClearAllRef.current();
          break;
      }
    }

    if (frame.paletteOpen !== paletteOpenRef.current) {
      paletteOpenRef.current = frame.paletteOpen;
      setPaletteOpen(frame.paletteOpen);
    }
    if (frame.hovered !== hoveredRef.current) {
      hoveredRef.current = frame.hovered;
      setHovered(frame.hovered);
    }
    updateDwellRing(frame.hovered ? frame.dwell : 0);
    updateCursor(frame.cursor);
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the tick to the parent so the camera loop can push samples into it.
  useEffect(() => {
    tickRef.current = tick;
    return () => {
      if (tickRef.current === tick) tickRef.current = null;
    };
  }, [tick, tickRef]);

  const setToolRef = (key: WritingTool) => (node: HTMLButtonElement | null) => {
    if (node) toolButtonRefs.current.set(key, node);
    else toolButtonRefs.current.delete(key);
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      {/* Fingertip cursor — a hollow ring, deliberately unlike the laser dot. */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-[0_0_8px_rgba(0,0,0,0.35)]"
        style={{ display: "none" }}
      />

      {/* Tool palette — shown only while the index finger is raised (§15). */}
      {paletteOpen ? (
        <div
          ref={paletteBoxRef}
          className="absolute bottom-[6%] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-card/95 px-2.5 py-2 shadow-soft backdrop-blur"
        >
          {WRITING_TOOL_ORDER.map((key) => {
            const isActive = key === tool;
            const isHovered = key === hovered;
            const ringClass = isActive
              ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
              : isHovered
                ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-card"
                : "";
            const colorIndex = key.startsWith("color-") ? Number(key.slice("color-".length)) : -1;
            return (
              <button
                key={key}
                ref={setToolRef(key)}
                type="button"
                aria-label={
                  colorIndex >= 0
                    ? `Writing color ${colorIndex + 1}`
                    : key === "clear-all"
                      ? "Clear all writing"
                      : "Manual eraser"
                }
                onClick={() => {
                  if (key === "clear-all") onClearAll();
                  else onSelectTool(key as ActiveWritingTool);
                }}
                className={`pointer-events-auto relative grid h-9 w-9 place-items-center rounded-full border border-border transition ${ringClass} ${colorIndex < 0 ? "bg-secondary text-foreground" : ""}`}
                style={colorIndex >= 0 ? { backgroundColor: WRITING_COLORS[colorIndex] } : undefined}
              >
                {key === "clear-all" ? <Trash2 className="h-4 w-4" /> : null}
                {key === "manual-eraser" ? <Eraser className="h-4 w-4" /> : null}
                {isHovered ? (
                  <svg className="pointer-events-none absolute -inset-1" viewBox="0 0 36 36" aria-hidden="true">
                    <circle
                      ref={dwellRingRef}
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className="text-amber-500"
                      transform="rotate(-90 18 18)"
                    />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

