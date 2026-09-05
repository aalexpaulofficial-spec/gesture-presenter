import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Minus, RefreshCw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gestureLabel, type Gesture } from "@/lib/hand-control";
import type { CameraStatus } from "@/hooks/useHandTracking";

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  error: string | null;
  gesture: Gesture;
  handVisible: boolean;
  hidden: boolean;
  /** Overrides the "pointing" gesture label so Master Write never shows "laser" (§13). */
  pointingLabel?: string | undefined;
  /** Label for the index + middle gesture in Master Write (it reopens the toolbar). */
  twoFingerLabel?: string | undefined;
  onRetry: () => void;
};

export function CameraWindow({
  videoRef,
  status,
  error,
  gesture,
  handVisible,
  hidden,
  pointingLabel,
  twoFingerLabel,
  onRetry,
}: Props) {
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState({ x: 16, y: 96 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    setPos((p) => ({
      x: Math.min(p.x, Math.max(8, window.innerWidth - 260)),
      y: Math.min(p.y, Math.max(8, window.innerHeight - 220)),
    }));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    },
    [pos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const width = minimized ? 150 : 232;
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - width, e.clientX - drag.current.dx)),
        y: Math.max(8, Math.min(window.innerHeight - 80, e.clientY - drag.current.dy)),
      });
    },
    [minimized],
  );

  const stopDrag = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <div
      className="fixed z-40 select-none"
      style={{ left: pos.x, top: pos.y, display: hidden ? "none" : undefined }}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card/95 shadow-soft backdrop-blur">
        <div
          className="flex cursor-grab touch-none items-center justify-between gap-2 px-3 py-2 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Video className="h-3.5 w-3.5 text-primary" />
            Hand camera
          </span>
          <button
            type="button"
            aria-label={minimized ? "Expand camera window" : "Minimize camera window"}
            onClick={() => setMinimized((m) => !m)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {minimized ? <Camera className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className={`relative h-[132px] w-[232px] bg-secondary ${minimized ? "hidden" : ""}`}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full scale-x-[-1] object-cover"
          />
          {status !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center px-3 text-center">
              {status === "error" ? (
                <div className="space-y-2">
                  <p className="text-[11px] leading-snug text-destructive">{error}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 text-[11px]"
                    onClick={onRetry}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" /> Try again
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Starting your camera…</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span
            className={`h-2 w-2 rounded-full ${
              status === "live" && handVisible
                ? "bg-primary"
                : status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground/50"
            }`}
          />
          <span className="truncate text-[11px] text-muted-foreground">
            {status === "live"
              ? gesture === "pointing" && pointingLabel
                ? pointingLabel
                : gesture === "two-fingers" && twoFingerLabel
                  ? twoFingerLabel
                  : gestureLabel[gesture]
              : status === "error"
                ? "Camera unavailable"
                : "Connecting"}
          </span>
        </div>
      </div>
    </div>
  );
}
