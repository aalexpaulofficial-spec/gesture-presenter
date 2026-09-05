import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { Eraser, Trash2 } from "lucide-react";
import {
  ERASER_MENU_ITEMS,
  ERASER_RADIUS,
  WRITING_COLOR_ORDER,
  WriteGestureMachine,
  colorValue,
  eraseFromStrokes,
  type CursorMode,
  type WriteMenuItem,
  type WriteTool,
  type WritingColor,
  type WritingPoint,
  type WritingStroke,
} from "@/lib/writing";

/**
 * The Master Write overlay: the ink canvas, the fingertip cursor, and the one
 * floating writing toolbar (§2). It sits on top of the rendered slide and never
 * touches the uploaded deck (§14). Nothing here reads the camera — fingertip
 * samples arrive through `tickRef` from the existing hand-tracking loop (§15).
 */

/** A fingertip sample pushed in from the hand-tracking loop, in slide space. */
export type WriteTick = (
  input: { point: WritingPoint; gesture: "index" | "eraser" } | null,
) => void;

type SlideRect = { x: number; y: number; w: number; h: number };

type Props = {
  /** Committed strokes for the slide on screen — the persisted source of truth. */
  strokes: WritingStroke[];
  /** Which slide these strokes belong to; a change resets the gesture machine. */
  slideIndex: number;
  /** The colour that is armed right now. */
  color: WritingColor;
  /** Filled by this layer so the camera loop can forward fingertip samples. */
  tickRef: MutableRefObject<WriteTick | null>;
  onSelectColor: (color: WritingColor) => void;
  onClearAll: () => void;
  onCommitStroke: (stroke: WritingStroke) => void;
  onErase: (point: WritingPoint) => void;
};

/** Names shown while the fingertip dwells on a toolbar item. */
const ITEM_LABEL: Record<WriteMenuItem, string> = {
  "color-0": "Red",
  "color-1": "Blue",
  "color-2": "Green",
  "color-3": "Yellow",
  "color-4": "White",
  "manual-eraser": "Manual Eraser",
  "clear-all": "Erase All",
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
    ctx.quadraticCurveTo(
      c.x * width,
      c.y * height,
      ((c.x + n.x) / 2) * width,
      ((c.y + n.y) / 2) * height,
    );
  }
  const last = pts[pts.length - 1];
  if (last) ctx.lineTo(last.x * width, last.y * height);
  ctx.stroke();
}
export function WritingLayer({
  strokes,
  slideIndex,
  color,
  tickRef,
  onSelectColor,
  onClearAll,
  onCommitStroke,
  onErase,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const cursorDotRef = useRef<HTMLSpanElement | null>(null);
  const buttonRefs = useRef(new Map<WriteMenuItem, HTMLButtonElement>());
  const dwellRingRef = useRef<SVGCircleElement | null>(null);

  const machineRef = useRef(new WriteGestureMachine());
  const liveRef = useRef<WritingStroke | null>(null);
  const strokesRef = useRef<WritingStroke[]>(strokes);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const itemRectsRef = useRef(new Map<WriteMenuItem, SlideRect>());
  const idRef = useRef(0);

  const toolbarOpenRef = useRef(false);
  const hoveredRef = useRef<WriteMenuItem | null>(null);
  const toolRef = useRef<WriteTool>("pen");
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [hovered, setHovered] = useState<WriteMenuItem | null>(null);
  const [tool, setTool] = useState<WriteTool>("pen");

  // Latest callbacks/props reached through refs so the tick closure stays stable
  // and no fingertip sample ever costs a React render (§8).
  const onSelectColorRef = useRef(onSelectColor);
  const onClearAllRef = useRef(onClearAll);
  const onCommitStrokeRef = useRef(onCommitStroke);
  const onEraseRef = useRef(onErase);
  const colorRef = useRef<WritingColor>(color);
  onSelectColorRef.current = onSelectColor;
  onClearAllRef.current = onClearAll;
  onCommitStrokeRef.current = onCommitStroke;
  onEraseRef.current = onErase;
  colorRef.current = color;

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

  // Size the canvas to the rendered slide box, so slide space (0..1) always maps
  // to the visible slide — through window resizes, scaling and fullscreen (§3).
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
      measureToolbar();
      repaint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [repaint]);

  // Cache each toolbar button in slide space (0..1) for fingertip hit-testing.
  // The toolbar is always mounted and only fades, so these rects stay valid.
  function measureToolbar(): void {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width === 0 || rootRect.height === 0) return;
    const rects = new Map<WriteMenuItem, SlideRect>();
    buttonRefs.current.forEach((btn, key) => {
      const r = btn.getBoundingClientRect();
      rects.set(key, {
        x: (r.left - rootRect.left) / rootRect.width,
        y: (r.top - rootRect.top) / rootRect.height,
        w: r.width / rootRect.width,
        h: r.height / rootRect.height,
      });
    });
    itemRectsRef.current = rects;
  }
  // Keep the local mirror in step with the persisted strokes (slide switches,
  // clears and erases all flow through here) and repaint.
  useEffect(() => {
    strokesRef.current = strokes;
    repaint();
  }, [strokes, repaint]);

  // A new slide starts from NORMAL: no tool armed, no toolbar, no half-drawn
  // stroke (§12). The presenter picks again before anything can be written.
  useEffect(() => {
    machineRef.current.reset();
    liveRef.current = null;
    toolbarOpenRef.current = false;
    hoveredRef.current = null;
    toolRef.current = "pen";
    setToolbarOpen(false);
    setHovered(null);
    setTool("pen");
    if (cursorRef.current) cursorRef.current.style.display = "none";
    repaint();
  }, [slideIndex, repaint]);

  // Re-measure when the toolbar appears, in case the layout shifted since mount.
  useEffect(() => {
    if (toolbarOpen) measureToolbar();
  }, [toolbarOpen]);

  function commitLiveStroke(): void {
    const stroke = liveRef.current;
    liveRef.current = null;
    if (stroke && stroke.points.length > 0) {
      strokesRef.current = [...strokesRef.current, stroke];
      onCommitStrokeRef.current(stroke);
    }
  }

  /** Rubs out only Master Write strokes under the fingertip — never the PPT (§9). */
  function applyErase(point: WritingPoint): void {
    const current = strokesRef.current;
    const next = eraseFromStrokes(current, point, ERASER_RADIUS, nextId);
    if (next !== current) {
      strokesRef.current = next;
      onEraseRef.current(point);
    }
  }
  /**
   * Moves the fingertip cursor. It is a plain style write on every sample — the
   * ring sits exactly on the fingertip, and its look says whether the finger is
   * pointing or actually working (§3 §5). Deliberately not a laser dot (§13).
   */
  function updateCursor(point: WritingPoint | null, mode: CursorMode): void {
    const el = cursorRef.current;
    const dot = cursorDotRef.current;
    if (!el) return;
    if (!point || !mode) {
      el.style.display = "none";
      return;
    }
    const eraser = mode === "eraser" || mode === "eraser-active";
    const active = mode === "pen-active" || mode === "eraser-active";
    const ink = colorValue(colorRef.current);
    const size = eraser ? Math.max(18, ERASER_RADIUS * 2 * sizeRef.current.w) : 16;
    el.style.display = "block";
    el.style.left = `${point.x * 100}%`;
    el.style.top = `${point.y * 100}%`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderWidth = active ? "3px" : "2px";
    el.style.borderColor = eraser
      ? "rgba(255,255,255,0.92)"
      : mode === "select"
        ? "rgba(148,163,184,0.95)"
        : ink;
    el.style.backgroundColor = mode === "eraser-active" ? "rgba(255,255,255,0.18)" : "transparent";
    el.style.boxShadow = mode === "pen-active" ? `0 0 10px ${ink}` : "0 0 8px rgba(0,0,0,0.35)";
    if (dot) dot.style.backgroundColor = mode === "pen-active" ? ink : "transparent";
  }

  function updateDwellRing(dwell: number): void {
    const ring = dwellRingRef.current;
    if (!ring) return;
    const circumference = 2 * Math.PI * 15.5;
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - Math.max(0, Math.min(1, dwell)))}`;
  }
  const tick = useCallback<WriteTick>((input) => {
    const now = performance.now();
    const point = input?.point ?? null;
    const gesture = input?.gesture ?? "none";

    // Fingertip → toolbar hit-test, only while the toolbar is on screen. When two
    // padded buttons overlap, the nearest centre wins (§4).
    let hit: WriteMenuItem | null = null;
    if (toolbarOpenRef.current && point) {
      const pad = 0.008;
      let best = Infinity;
      for (const [candidate, r] of itemRectsRef.current) {
        if (
          point.x >= r.x - pad &&
          point.x <= r.x + r.w + pad &&
          point.y >= r.y - pad &&
          point.y <= r.y + r.h + pad
        ) {
          const dx = point.x - (r.x + r.w / 2);
          const dy = point.y - (r.y + r.h / 2);
          const d = dx * dx + dy * dy;
          if (d < best) {
            best = d;
            hit = candidate;
          }
        }
      }
    }

    const frame = machineRef.current.update({ gesture, point, hit, now });

    for (const effect of frame.effects) {
      switch (effect.kind) {
        case "begin":
          liveRef.current = {
            id: nextId(),
            color: colorValue(colorRef.current),
            points: [effect.point],
          };
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
        case "select-color":
          onSelectColorRef.current(effect.color);
          break;
        case "select-eraser":
          // The armed tool arrives on `frame.tool` below; nothing else to do.
          break;
        case "clear":
          onClearAllRef.current();
          break;
      }
    }
    // Only three things ever reach React: toolbar visibility, the hovered item and
    // the armed tool. Coordinates stay in refs and on the canvas (§8).
    if (frame.toolbarOpen !== toolbarOpenRef.current) {
      toolbarOpenRef.current = frame.toolbarOpen;
      setToolbarOpen(frame.toolbarOpen);
    }
    if (frame.hovered !== hoveredRef.current) {
      hoveredRef.current = frame.hovered;
      setHovered(frame.hovered);
    }
    if (frame.tool !== toolRef.current) {
      toolRef.current = frame.tool;
      setTool(frame.tool);
    }
    updateDwellRing(frame.hovered ? frame.dwell : 0);
    updateCursor(frame.cursor, frame.cursorMode);
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hand the tick to the parent so the existing camera loop can push samples in.
  useEffect(() => {
    tickRef.current = tick;
    return () => {
      if (tickRef.current === tick) tickRef.current = null;
    };
  }, [tick, tickRef]);

  const setButtonRef = (key: WriteMenuItem) => (node: HTMLButtonElement | null) => {
    if (node) buttonRefs.current.set(key, node);
    else buttonRefs.current.delete(key);
  };

  const dwellRing = (
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
  );
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />

      {/* Fingertip cursor — a hollow ring that gains a core while it works. */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
        style={{ display: "none" }}
      >
        <span
          ref={cursorDotRef}
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
      </div>

      {/* The one writing toolbar (§2): five colours, Manual Eraser, Erase All.
          Always mounted so the fingertip hit-boxes stay measured; it fades in and
          out instead of remounting, and gets out of the way after a pick (§11). */}
      <div
        aria-hidden={!toolbarOpen}
        className={`absolute bottom-[5%] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-card/70 px-2.5 py-2 shadow-soft backdrop-blur-md transition-opacity duration-200 ease-out ${
          toolbarOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        {toolbarOpen && hovered ? (
          <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card/90 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-soft backdrop-blur">
            {ITEM_LABEL[hovered]}
          </span>
        ) : null}
        {WRITING_COLOR_ORDER.map((key) => {
          const isActive = tool === "pen" && key === color;
          const isHovered = key === hovered;
          const ringClass = isHovered
            ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-card"
            : isActive
              ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
              : "";
          return (
            <button
              key={key}
              ref={setButtonRef(key)}
              type="button"
              tabIndex={toolbarOpen ? 0 : -1}
              aria-label={`Write in ${ITEM_LABEL[key]}`}
              title={ITEM_LABEL[key]}
              onClick={() => onSelectColor(key)}
              className={`relative grid h-9 w-9 place-items-center rounded-full border border-border transition ${
                toolbarOpen ? "pointer-events-auto" : "pointer-events-none"
              } ${ringClass}`}
              style={{ backgroundColor: colorValue(key) }}
            >
              {isHovered ? dwellRing : null}
            </button>
          );
        })}

        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-border" />
        {ERASER_MENU_ITEMS.map((key) => {
          const isActive = key === "manual-eraser" && tool === "eraser";
          const isHovered = key === hovered;
          const ringClass = isHovered
            ? "ring-2 ring-amber-500 ring-offset-2 ring-offset-card"
            : isActive
              ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
              : "";
          return (
            <button
              key={key}
              ref={setButtonRef(key)}
              type="button"
              tabIndex={toolbarOpen ? 0 : -1}
              aria-label={ITEM_LABEL[key]}
              title={ITEM_LABEL[key]}
              onClick={key === "clear-all" ? () => onClearAll() : undefined}
              className={`relative grid h-9 w-9 place-items-center rounded-full border border-border bg-secondary text-foreground transition ${
                toolbarOpen ? "pointer-events-auto" : "pointer-events-none"
              } ${ringClass}`}
            >
              {key === "manual-eraser" ? (
                <Eraser className="h-4 w-4" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isHovered ? dwellRing : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
