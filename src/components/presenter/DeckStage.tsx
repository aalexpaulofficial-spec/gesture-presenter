import { useEffect, useRef, useState } from "react";

type Previewer = {
  load: (buf: ArrayBuffer) => Promise<{ width: number; height: number; slides: unknown[] }>;
  renderSingleSlide: (i: number) => void;
  destroy: () => void;
};

type Props = {
  /** The user's uploaded deck. It is the only source of truth for what is shown. */
  buffer: ArrayBuffer;
  index: number;
  pointer: { x: number; y: number } | null;
  onReady: (info: { slideCount: number }) => void;
  onError: (message: string) => void;
};

export function DeckStage({ buffer, index, pointer, onReady, onError }: Props) {
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
        const probe = init(probeHost, { width: 10, height: 10, mode: "slide" }) as unknown as Previewer;
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
          errorRef.current("We couldn't read this presentation. Please try another .ppt or .pptx file.");
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
      </div>
    </div>
  );
}
