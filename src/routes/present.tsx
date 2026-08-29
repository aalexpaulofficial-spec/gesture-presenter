import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  HelpCircle,
  Maximize,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DeckStage } from "@/components/presenter/DeckStage";
import { CameraWindow } from "@/components/presenter/CameraWindow";
import { useHandTracking } from "@/hooks/useHandTracking";

export const Route = createFileRoute("/present")({
  head: () => ({
    meta: [
      { title: "Present with your hands — PPT Hand Control" },
      {
        name: "description",
        content:
          "Upload your presentation and control slides with simple hand gestures. Front palm for next, back palm for previous, index finger for a laser pointer.",
      },
      { property: "og:title", content: "Present with your hands — PPT Hand Control" },
      {
        property: "og:description",
        content: "Upload a presentation and control it with hand gestures, straight from your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PresentPage,
});

type Phase = "upload" | "uploading" | "analyzing" | "preview" | "ready" | "failed";

const phaseCopy: Record<Exclude<Phase, "upload" | "ready" | "failed">, string> = {
  uploading: "Uploading file",
  analyzing: "Analyzing presentation",
  preview: "Generating preview",
};

function PresentPage() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [progress, setProgress] = useState(0);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("");
  const [slideCount, setSlideCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const max = Math.max(0, slideCount - 1);
        return Math.min(max, Math.max(0, i + delta));
      });
    },
    [slideCount],
  );

  const onAction = useCallback((action: "next" | "prev") => go(action === "next" ? 1 : -1), [go]);

  const { videoRef, status, error, gesture, handVisible, retry } = useHandTracking({
    enabled: phase === "preview" || phase === "ready",
    onAction,
    onPointer: setPointer,
  });

  const handleFile = useCallback(async (file: File) => {
    const ok = /\.pptx?$/i.test(file.name);
    if (!ok) {
      setFailure("Please choose a .ppt or .pptx presentation.");
      setPhase("failed");
      return;
    }
    setFileName(file.name);
    setFailure(null);
    setIndex(0);
    setSlideCount(0);
    setPhase("uploading");
    setProgress(12);
    const buf = await file.arrayBuffer();
    setProgress(45);
    setPhase("analyzing");
    await new Promise((r) => setTimeout(r, 320));
    setProgress(72);
    setPhase("preview");
    setBuffer(buf);
  }, []);

  const onReady = useCallback(({ slideCount: count }: { slideCount: number }) => {
    setSlideCount(count);
    setProgress(100);
    setPhase("ready");
  }, []);

  const onDeckError = useCallback((message: string) => {
    setFailure(message);
    setPhase("failed");
  }, []);

  // Fullscreen shows only the slide.
  const toggleFullscreen = useCallback(async () => {
    const el = stageWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else {
      await el.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const loading = phase === "uploading" || phase === "analyzing" || phase === "preview";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {!isFullscreen && (
        <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-display text-sm font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Hand className="h-4 w-4" />
            </span>
            PPT Hand Control
          </Link>
          <span className="max-w-[45vw] truncate text-xs text-muted-foreground">{fileName}</span>
        </header>
      )}

      {phase === "upload" || phase === "failed" ? (
        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-xl text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Upload your presentation
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Your slides stay exactly as you designed them. Nothing is redesigned, replaced or reformatted.
            </p>
            <label
              className="mt-8 flex cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-border bg-card px-6 py-14 transition-colors hover:border-primary/60 hover:bg-primary-soft/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFile(f);
              }}
            >
              <UploadCloud className="h-9 w-9 text-primary" />
              <span className="font-display text-base font-semibold">Choose a .ppt or .pptx file</span>
              <span className="text-xs text-muted-foreground">or drag and drop it here</span>
              <input
                ref={inputRef}
                type="file"
                accept=".ppt,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </label>
            {failure && <p className="mt-5 text-sm text-destructive">{failure}</p>}
          </div>
        </main>
      ) : (
        <main className="flex flex-1 flex-col">
          <div
            ref={stageWrapRef}
            className="relative flex-1 bg-[oklch(0.16_0.015_158)] [&:fullscreen]:h-screen [&:fullscreen]:w-screen"
          >
            {buffer && (
              <DeckStage
                buffer={buffer}
                index={index}
                pointer={pointer}
                onReady={onReady}
                onError={onDeckError}
              />
            )}
            {loading && (
              <div className="absolute inset-0 grid place-items-center bg-background/95">
                <div className="w-full max-w-sm px-6 text-center">
                  <p className="font-display text-lg font-semibold">
                    {phaseCopy[phase as keyof typeof phaseCopy]}
                  </p>
                  <Progress value={progress} className="mt-4" />
                  <p className="mt-3 truncate text-xs text-muted-foreground">{fileName}</p>
                </div>
              </div>
            )}
          </div>

          {!isFullscreen && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-border px-4 py-3 sm:gap-3">
              <Button variant="secondary" onClick={() => go(-1)} disabled={index === 0}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <Button variant="secondary" onClick={() => go(1)} disabled={index >= slideCount - 1}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
              <Button onClick={() => void toggleFullscreen()}>
                <Maximize className="mr-1 h-4 w-4" /> Enter Fullscreen
              </Button>
              <HowToControl />
              <span className="ml-1 text-xs text-muted-foreground">
                {slideCount ? `${index + 1} / ${slideCount}` : ""}
              </span>
            </div>
          )}
        </main>
      )}

      {(phase === "preview" || phase === "ready") && (
        <CameraWindow
          videoRef={videoRef}
          status={status}
          error={error}
          gesture={gesture}
          handVisible={handVisible}
          hidden={isFullscreen}
          onRetry={retry}
        />
      )}
    </div>
  );
}

function HowToControl() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <HelpCircle className="mr-1 h-4 w-4" /> How to Control
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Control your slides with your hand</DialogTitle>
          <DialogDescription>
            Hold your hand about an arm's length from the camera in reasonable light.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg">🖐️</span>
            <span>
              <strong className="font-display">Open front palm</strong> — move to the next slide.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg">🤚</span>
            <span>
              <strong className="font-display">Back of your hand</strong> — go to the previous slide.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg">☝️</span>
            <span>
              <strong className="font-display">Raised index finger</strong> — a laser pointer follows your
              fingertip across the whole slide.
            </span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Fullscreen shows only your slide, and hand control keeps working while you present.
        </p>
      </DialogContent>
    </Dialog>
  );
}
