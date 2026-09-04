import { useEffect, useRef, useState } from "react";
import { VoiceHighlight } from "@/hooks/useVoiceControl";

type Previewer = {
  load: (buf: ArrayBuffer) => Promise<{ width: number; height: number; slides: unknown[] }>;
  renderSingleSlide: (i: number) => void;
  destroy: () => void;
};

export type WritingPoint = { x: number; y: number };
export type WritingStroke = {
  id: string;
  color: string;
  points: WritingPoint[];
};

type Props = {
  /** The user's uploaded deck. It is the only source of truth for what is shown. */
  buffer: ArrayBuffer;
  index: number;
  pointer: { x: number; y: number } | null;
  writingStrokes?: WritingStroke[];
  highlights?: VoiceHighlight[];
  onReady: (info: { slideCount: number }) => void;
  onError: (message: string) => void;
};

export function DeckStage({
  buffer,
  index,
  pointer,
  writingStrokes = [],
  highlights = [],
  onReady,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const previewerRef = useRef<Previewer | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const readyRef = useRef(onReady);
  const errorRef = useRef(onError);
  readyRef.current = onReady;
  errorRef.current = onError;

  // Parse + render the uploaded deck at its native slide size.
  useEffect(() => {
    let cancelled = false;
    let previewer: Previewer | null = null;

    async function render() {
      try {
        const { init } = await import("pptx-preview");
        const probeHost = document.createElement("div");
        const probe = init(probeHost, {
          width: 10,
          height: 10,
          mode: "slide",
        }) as unknown as Previewer;
        const meta = await probe.load(buffer.slice(0));
        const w = Math.round(meta.width) || 960;
        const h = Math.round(meta.height) || 540;
        const slideCount = meta.slides?.length ?? 1;
        if (cancelled) return;

        const host = stageRef.current;
        if (!host) return;
        host.innerHTML = "";
        previewer = init(host, { width: w, height: h, mode: "slide" }) as unknown as Previewer;
        await previewer.load(buffer.slice(0));
        if (cancelled) return;
        previewer.renderSingleSlide(0);
        previewerRef.current = previewer;
        setDims({ w, h });
        readyRef.current({ slideCount });
      } catch {
        if (!cancelled) {
          errorRef.current(
            "We couldn't read this presentation. Please try another .ppt or .pptx file.",
          );
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      previewerRef.current = null;
      previewer = null;
    };
  }, [buffer]);

  // Slide navigation always acts on the uploaded deck.
  useEffect(() => {
    if (!dims) return;
    previewerRef.current?.renderSingleSlide(index);
  }, [index, dims]);

  // Fit the native slide into the available area without cropping or distortion.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !dims) return;
    const fit = () => {
      const rect = container.getBoundingClientRect();
      setScale(Math.min(rect.width / dims.w, rect.height / dims.h));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [dims]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <div
        className="relative"
        style={dims ? { width: dims.w * scale, height: dims.h * scale } : undefined}
      >
        <div
          ref={stageRef}
          className="deck-stage origin-top-left"
          style={dims ? { width: dims.w, height: dims.h, transform: `scale(${scale})` } : undefined}
        />
        {/* Laser overlay — drawn above the slide, never modifies it. */}
        {pointer && dims ? (
          <div
            className="pointer-events-none absolute z-30"
            style={{
              left: `${pointer.x * 100}%`,
              top: `${pointer.y * 100}%`,
              transform: "translate(-50%, -50%)",
              willChange: "left, top",
            }}
          >
            <span className="block h-4 w-4 rounded-full bg-[oklch(0.62_0.24_25)] shadow-[0_0_22px_10px_oklch(0.62_0.24_25/0.45)]" />
          </div>
        ) : null}

        {/* Writing overlay - frontend-only annotation strokes, never edits the uploaded deck. */}
        {dims && writingStrokes.length > 0 ? (
          <svg
            className="pointer-events-none absolute inset-0 z-[25]"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {writingStrokes.map((stroke) => {
              if (stroke.points.length === 0) return null;
              if (stroke.points.length === 1) {
                const point = stroke.points[0];
                if (!point) return null;
                return (
                  <circle
                    key={stroke.id}
                    cx={point.x}
                    cy={point.y}
                    r={0.0045}
                    fill={stroke.color}
                  />
                );
              }
              return (
                <polyline
                  key={stroke.id}
                  points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={0.0065}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}

        {/* Voice highlights */}
        {highlights.map((h) => {
          const colorKey = h.color.toLowerCase();
          const colorMap: Record<string, { border: string; bg: string }> = {
            yellow: { border: "#eab308", bg: "rgba(250, 204, 21, 0.35)" },
            red: { border: "#ef4444", bg: "rgba(239, 68, 68, 0.35)" },
            green: { border: "#22c55e", bg: "rgba(34, 197, 94, 0.35)" },
            blue: { border: "#3b82f6", bg: "rgba(59, 130, 246, 0.35)" },
          };
          const current = colorMap[colorKey] || colorMap.yellow;
          return (
            <div
              key={h.id}
              className="pointer-events-none absolute z-20 border-2 rounded-sm transition-all duration-300"
              style={{
                left: `${h.box.left * 100}%`,
                top: `${h.box.top * 100}%`,
                width: `${h.box.width * 100}%`,
                height: `${h.box.height * 100}%`,
                borderColor: current.border,
                backgroundColor: current.bg,
                boxShadow: `0 0 10px ${current.bg}`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
