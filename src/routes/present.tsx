import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eraser,
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
import { WritingLayer, type WriteTick } from "@/components/presenter/WritingLayer";
import { useHandTracking, type IndexFingerPoint } from "@/hooks/useHandTracking";
import { useVoiceControl, VoiceHighlight } from "@/hooks/useVoiceControl";
import {
  ERASER_RADIUS,
  eraseFromStrokes,
  type WritingColor,
  type WritingPoint,
  type WritingStroke,
} from "@/lib/writing";
import { Mic, MicOff, Sparkles } from "lucide-react";

export const Route = createFileRoute("/present")({
  head: () => ({
    meta: [
      { title: "Present with your hands — Master Presenter" },
      {
        name: "description",
        content:
          "Upload your presentation and control slides with simple hand gestures. Front palm for next, back palm for previous, index finger for a laser pointer.",
      },
      { property: "og:title", content: "Present with your hands — Master Presenter" },
      {
        property: "og:description",
        content:
          "Upload a presentation and control it with hand gestures, straight from your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { pro?: boolean; plan?: string } => {
    const out: { pro?: boolean; plan?: string } = {
      pro: search["pro"] === true || search["pro"] === "true",
    };
    if (typeof search["plan"] === "string") out.plan = search["plan"];
    return out;
  },
  component: PresentPage,
});

type Phase = "upload" | "uploading" | "analyzing" | "preview" | "ready" | "failed";

const phaseCopy: Record<Exclude<Phase, "upload" | "ready" | "failed">, string> = {
  uploading: "Uploading file",
  analyzing: "Analyzing presentation",
  preview: "Generating preview",
};

function formatPlanBadge(plan?: string | null): string {
  if (!plan) return "MASTER HAND";
  const p = plan.trim().toLowerCase();
  if (p === "master voice" || p === "master_voice" || p === "mastervoice" || p === "voice") {
    return "MASTER VOICE";
  }
  if (p === "master write" || p === "master_write" || p === "masterwrite" || p === "write") {
    return "MASTER WRITE";
  }
  if (p === "master ai" || p === "master_ai" || p === "masterai" || p === "ai") {
    return "MASTER AI";
  }
  if (p.includes("voice")) return "MASTER VOICE";
  if (p.includes("write")) return "MASTER WRITE";
  if (p.includes("ai")) return "MASTER AI";
  if (p.includes("business")) return "BUSINESS";
  if (p.includes("hand") || p === "free") return "MASTER HAND";
  if (p === "pro") return "MASTER VOICE";
  return plan.toUpperCase();
}

function getStoredPlan(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("master_presenter_selected_plan");
  } catch {
    return null;
  }
}

function setStoredPlan(plan: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("master_presenter_selected_plan", plan);
  } catch {
    // ignore
  }
}

function capabilitiesForPlan(plan: string) {
  const normalized = formatPlanBadge(plan);
  return {
    hands: true,
    voice: normalized !== "MASTER HAND",
    laser: normalized !== "MASTER WRITE",
    writing: normalized === "MASTER WRITE",
  };
}

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
  const search = Route.useSearch();
  const [planName, setPlanName] = useState<string>(() => {
    if (search.plan) return formatPlanBadge(search.plan);
    const stored = getStoredPlan();
    if (stored) return formatPlanBadge(stored);
    if (search.pro) return "MASTER VOICE";
    return "MASTER HAND";
  });
  const [isPro, setIsPro] = useState<boolean>(() => {
    const initial = search.plan
      ? formatPlanBadge(search.plan)
      : getStoredPlan()
        ? formatPlanBadge(getStoredPlan())
        : search.pro
          ? "MASTER VOICE"
          : "MASTER HAND";
    return initial !== "MASTER HAND";
  });

  useEffect(() => {
    if (search.plan) {
      const formatted = formatPlanBadge(search.plan);
      setPlanName(formatted);
      setIsPro(formatted !== "MASTER HAND");
      setStoredPlan(formatted);
    } else if (search.pro && !getStoredPlan()) {
      setPlanName("MASTER VOICE");
      setIsPro(true);
      setStoredPlan("MASTER VOICE");
    }
  }, [search.plan, search.pro]);

  const [metadata, setMetadata] = useState<any[] | null>(null);
  const [highlights, setHighlights] = useState<VoiceHighlight[]>([]);
  const [writingBySlide, setWritingBySlide] = useState<Record<number, WritingStroke[]>>({});
  const [activeWritingColor, setActiveWritingColor] = useState<WritingColor>("color-0");
  const capabilities = capabilitiesForPlan(planName);

  const slideCountRef = useRef(slideCount);
  slideCountRef.current = slideCount;

  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  // WritingLayer fills this so the camera loop can push fingertip samples into it.
  const writeTickRef = useRef<WriteTick | null>(null);
  const eraseIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<File | null>(null);

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const total = slideCountRef.current || slideCount;
        const max = Math.max(0, total - 1);
        return Math.min(max, Math.max(0, i + delta));
      });
    },
    [slideCount],
  );

  const onAction = useCallback((action: "next" | "prev") => go(action === "next" ? 1 : -1), [go]);

  const clearWriting = useCallback(() => {
    setWritingBySlide((prev) => {
      const strokes = prev[index] ?? [];
      if (strokes.length === 0) return prev;
      return { ...prev, [index]: [] };
    });
  }, [index]);

  const commitStroke = useCallback(
    (stroke: WritingStroke) => {
      setWritingBySlide((prev) => ({
        ...prev,
        [index]: [...(prev[index] ?? []), stroke],
      }));
    },
    [index],
  );

  const eraseAt = useCallback(
    (point: WritingPoint) => {
      setWritingBySlide((prev) => {
        const strokes = prev[index] ?? [];
        const next = eraseFromStrokes(strokes, point, ERASER_RADIUS, () => {
          eraseIdRef.current += 1;
          return `e${eraseIdRef.current}`;
        });
        if (next === strokes) return prev;
        return { ...prev, [index]: next };
      });
    },
    [index],
  );

  const selectWritingColor = useCallback((color: WritingColor) => {
    setActiveWritingColor(color);
  }, []);

  // The camera loop feeds fingertip samples straight into the WritingLayer,
  // which owns the palette, gesture machine and canvas. The index finger never
  // reaches the laser in Master Write (§12); index + middle drives the eraser.
  const handleIndexPoint = useCallback(
    (point: IndexFingerPoint | null) => {
      if (!capabilities.writing) return;
      writeTickRef.current?.(point ? { point: point.slide, gesture: point.mode } : null);
    },
    [capabilities.writing],
  );

  const { videoRef, status, error, gesture, handVisible, retry } = useHandTracking({
    enabled: phase === "preview" || phase === "ready",
    onAction,
    onPointer: setPointer,
    pointerMode: capabilities.writing ? "writing" : "laser",
    onIndexPoint: handleIndexPoint,
  });

  // If the camera drops out mid-stroke, close any open writing cleanly.
  useEffect(() => {
    if (capabilities.writing && status !== "live") writeTickRef.current?.(null);
  }, [capabilities.writing, status]);

  const handleFile = useCallback(async (file: File) => {
    const ok = /\.pptx?$/i.test(file.name);
    if (!ok) {
      setFailure("Please choose a .ppt or .pptx presentation.");
      setPhase("failed");
      return;
    }
    fileRef.current = file;
    setFileName(file.name);
    setFailure(null);
    setIndex(0);
    setSlideCount(0);
    setMetadata(null);
    setHighlights([]);
    setWritingBySlide({});
    setPhase("uploading");
    setProgress(12);
    const buf = await file.arrayBuffer();
    setProgress(45);
    setPhase("analyzing");

    await new Promise((r) => setTimeout(r, 220));

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

  // Pro: read the uploaded deck's text boxes in the browser so voice
  // highlighting targets the real slide content. The file is never modified.
  useEffect(() => {
    if (!capabilities.voice || !buffer || metadata !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const { extractSlideText } = await import("@/lib/pptx-text");
        const slides = await extractSlideText(buffer);
        if (!cancelled) setMetadata(slides);
      } catch {
        if (!cancelled) setMetadata([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capabilities.voice, buffer, metadata]);

  const handleHighlight = useCallback(
    (text: string, color: string) => {
      const needle = text.toLowerCase().trim();
      if (!needle) return;

      // 1. Search extracted metadata for current slide
      const slide = metadata?.[index];
      const elements: any[] = slide?.text_elements || [];
      const match =
        elements.find((e) => e.text.toLowerCase().includes(needle)) ??
        elements.find((e) =>
          needle.split(" ").some((word) => word.length > 2 && e.text.toLowerCase().includes(word)),
        );

      if (match) {
        setHighlights((prev) => {
          const filtered = prev.filter(
            (h) => !h.text.toLowerCase().includes(needle) && !needle.includes(h.text.toLowerCase()),
          );
          return [
            ...filtered,
            {
              id: Math.random().toString(36).slice(2),
              text: match.text,
              color,
              box: { left: match.left, top: match.top, width: match.width, height: match.height },
            },
          ];
        });
        return;
      }

      // 2. Fallback: Search rendered DOM inside slide stage container
      const stage = stageWrapRef.current?.querySelector(".deck-stage") as HTMLElement | null;
      if (stage) {
        const stageRect = stage.getBoundingClientRect();
        if (stageRect.width > 0 && stageRect.height > 0) {
          const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          let matchedEl: HTMLElement | SVGElement | null = null;
          while ((node = walker.nextNode())) {
            const val = node.nodeValue?.toLowerCase().trim() || "";
            if (val.includes(needle) || (needle.length > 3 && val.includes(needle.slice(0, 4)))) {
              const parent = node.parentElement;
              if (parent && parent !== stage) {
                matchedEl = parent;
                break;
              }
            }
          }

          if (matchedEl) {
            const elRect = matchedEl.getBoundingClientRect();
            const left = Math.max(0, (elRect.left - stageRect.left) / stageRect.width);
            const top = Math.max(0, (elRect.top - stageRect.top) / stageRect.height);
            const width = Math.min(1 - left, elRect.width / stageRect.width);
            const height = Math.min(1 - top, elRect.height / stageRect.height);

            if (width > 0 && height > 0) {
              setHighlights((prev) => {
                const filtered = prev.filter(
                  (h) =>
                    !h.text.toLowerCase().includes(needle) &&
                    !needle.includes(h.text.toLowerCase()),
                );
                return [
                  ...filtered,
                  {
                    id: Math.random().toString(36).slice(2),
                    text: matchedEl!.textContent?.trim() || needle,
                    color,
                    box: { left, top, width, height },
                  },
                ];
              });
              return;
            }
          }
        }
      }

      // If text does not exist on current slide: DO NOTHING (no fake highlight)
    },
    [metadata, index],
  );

  const handleRemoveHighlight = useCallback((text: string) => {
    const needle = text.toLowerCase().trim();
    if (!needle) return;
    setHighlights((prev) =>
      prev.filter(
        (h) => !h.text.toLowerCase().includes(needle) && !needle.includes(h.text.toLowerCase()),
      ),
    );
  }, []);

  const handleClearHighlights = useCallback(() => {
    setHighlights([]);
  }, []);

  const handleGoToSlideByText = useCallback(
    (text: string) => {
      if (!metadata) return false;
      const lowerText = text.toLowerCase();

      const matchingSlideIndex = metadata.findIndex((slide: any) => {
        if (slide.title && slide.title.toLowerCase().includes(lowerText)) return true;
        if (slide.text_elements) {
          return slide.text_elements.some((el: any) => el.text.toLowerCase().includes(lowerText));
        }
        return false;
      });

      if (matchingSlideIndex !== -1) {
        setIndex(matchingSlideIndex);
        return true;
      }
      // No slide carries that text: report the miss instead of claiming success.
      return false;
    },
    [metadata],
  );

  const {
    micState,
    status: voiceStatus,
    supported,
  } = useVoiceControl({
    enabled: capabilities.voice && (phase === "preview" || phase === "ready"),
    extendedCommands: true,
    onNext: () => go(1),
    onPrev: () => go(-1),
    onGoToSlide: (slide: number) => {
      // The uploaded deck is the only source of truth for the slide count, and
      // it is not known until DeckStage reports it. Until then, and for any
      // number past the last slide, do nothing at all.
      const total = slideCountRef.current || slideCount;
      if (total <= 0) return false;
      const max = total - 1;
      if (slide < 0 || slide > max) return false;
      setIndex(slide);
      return true;
    },
    onHighlight: handleHighlight,
    onRemoveHighlight: handleRemoveHighlight,
    onClearHighlights: handleClearHighlights,
    onGoToSlideByText: handleGoToSlideByText,
  });

  // Compact status label — the colour itself is micState. The microphone
  // starts automatically after permission; there is no manual mic toggle.
  let statusLabel = "Voice unavailable";
  if (supported) {
    switch (voiceStatus) {
      case "starting":
        statusLabel = "Voice starting…";
        break;
      case "listening":
        statusLabel = "Listening";
        break;
      case "executed":
        statusLabel = "Command executed";
        break;
      case "slide_not_found":
        statusLabel = "Slide not found";
        break;
      case "permission_denied":
        statusLabel = "Mic permission denied";
        break;
      case "error":
        statusLabel = "Voice error — retrying…";
        break;
      case "off":
        statusLabel = "Voice starting…";
        break;
      default:
        statusLabel = "Listening";
    }
  }

  // Clear highlights when slide changes
  useEffect(() => {
    setHighlights([]);
  }, [index]);

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
          <div className="flex items-center gap-1">
            <Link
              to="/"
              aria-label="Back to home"
              className="grid h-8 w-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <Link to="/" className="flex items-center gap-2 font-display text-sm font-semibold">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Hand className="h-4 w-4" />
              </span>
              Master Presenter
            </Link>
            <span
              className={`ml-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                isPro
                  ? "bg-primary/20 text-primary"
                  : "bg-secondary text-muted-foreground border border-border"
              }`}
            >
              {planName.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="max-w-[30vw] truncate text-xs text-muted-foreground">{fileName}</span>
            {!isPro && phase === "upload" && (
              <Button asChild size="sm" variant="outline">
                <Link to="/" hash="pricing">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Get Free Premium Master Plans —
                  Unlimited
                </Link>
              </Button>
            )}
          </div>
        </header>
      )}

      {phase === "upload" || phase === "failed" ? (
        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-xl text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Upload your presentation
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Your slides stay exactly as you designed them. Nothing is redesigned, replaced or
              reformatted.
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
              <span className="font-display text-base font-semibold">
                Choose a .ppt or .pptx file
              </span>
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
                pointer={capabilities.laser ? pointer : null}
                overlay={
                  capabilities.writing ? (
                    <WritingLayer
                      strokes={writingBySlide[index] ?? []}
                      slideIndex={index}
                      color={activeWritingColor}
                      tickRef={writeTickRef}
                      onSelectColor={selectWritingColor}
                      onClearAll={clearWriting}
                      onCommitStroke={commitStroke}
                      onErase={eraseAt}
                    />
                  ) : undefined
                }
                highlights={highlights}
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
              <HowToControl planName={planName} />
              {capabilities.voice && (
                <div className="flex items-center gap-2 ml-2">
                  {!supported ? (
                    <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-destructive/50 bg-destructive/10 text-destructive">
                      <MicOff className="h-3.5 w-3.5" />
                      Voice not supported in this browser
                    </div>
                  ) : (
                    // Compact, visual-only status indicator. The microphone
                    // starts automatically after permission is granted — this
                    // is NOT a manual mic on/off toggle.
                    <div
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                        micState === "green"
                          ? "border-green-500/60 bg-green-500/10 text-green-600"
                          : micState === "yellow"
                            ? "border-amber-500/60 bg-amber-500/10 text-amber-600"
                            : "border-destructive/50 bg-destructive/10 text-destructive"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full transition-colors ${
                          micState === "green"
                            ? "bg-green-500"
                            : micState === "yellow"
                              ? "bg-amber-500"
                              : "bg-red-500"
                        }`}
                      />
                      {statusLabel}
                    </div>
                  )}
                </div>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
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
          pointingLabel={capabilities.writing ? "Index finger — writing" : undefined}
          twoFingerLabel={capabilities.writing ? "Index + middle — eraser" : undefined}
          onRetry={retry}
        />
      )}
    </div>
  );
}

function HowToControl({ planName }: { planName: string }) {
  const capabilities = capabilitiesForPlan(planName);
  const handControls = [
    { icon: "Palm", cmd: "Open Front Palm", desc: "Next Slide" },
    { icon: "Fist", cmd: "Close hand -> reopen Front Palm", desc: "Next Slide again" },
    { icon: "Back", cmd: "Back of Hand", desc: "Previous Slide" },
    { icon: "Fist", cmd: "Close hand -> reopen Back of Hand", desc: "Previous Slide again" },
    capabilities.writing
      ? { icon: "Draw", cmd: "Raised Index Finger", desc: "Write on the slide" }
      : { icon: "Point", cmd: "Raised Index Finger", desc: "Laser Pointer" },
    ...(capabilities.writing
      ? [{ icon: "Erase", cmd: "Index + Middle Finger", desc: "Open eraser controls" }]
      : []),
  ];

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <HelpCircle className="mr-1 h-4 w-4" /> How to Control
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">How to Control</DialogTitle>
          <DialogDescription>
            {capabilities.writing
              ? "Hand + Voice + Writing Controls"
              : capabilities.voice
                ? "Hand + Voice Controls"
                : "Hand + Camera"}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-1 rounded-2xl border border-border bg-card p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Hand className="h-4 w-4 text-primary" /> Hand + Camera
          </p>
          <ul className="space-y-3 text-sm">
            {handControls.map(({ icon, cmd, desc }) => (
              <li key={cmd} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="w-10 shrink-0 font-mono text-[11px] leading-5 text-primary"
                >
                  {icon}
                </span>
                <span>
                  <strong className="font-semibold">{cmd}</strong>
                  <span className="text-muted-foreground">
                    {" -> "}
                    {desc}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
            {capabilities.writing
              ? "In Master Write, the index finger is reserved for writing only. Laser pointer is not available and cannot be triggered accidentally."
              : "The laser pointer works only from your hand - a raised index finger. It is never triggered by voice."}
          </p>
        </div>

        {capabilities.voice && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Mic className="h-4 w-4 text-primary" /> Voice
            </p>
            <ul className="space-y-2.5 text-sm">
              {[
                { cmd: "next", desc: "Go to the next slide" },
                { cmd: "previous", desc: "Go to the previous slide" },
                { cmd: "8", desc: "Jump straight to Slide 8" },
                { cmd: "15", desc: "Jump straight to Slide 15" },
                { cmd: "eight", desc: "Number words work too — “eight” opens Slide 8" },
              ].map(({ cmd, desc }) => (
                <li key={cmd} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground whitespace-nowrap">
                    “{cmd}”
                  </span>
                  <span className="text-muted-foreground">→ {desc}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
              The microphone starts automatically once you allow mic permission — no button needed.
              The status dot shows green when a command is detected, yellow while listening, red
              when voice is unavailable. Normal presentation speech is ignored — only these exact
              commands run, and they change slides silently with no sounds or spoken responses.
            </p>
          </div>
        )}

        {capabilities.writing && (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Eraser className="h-4 w-4 text-primary" /> Master Write
            </p>
            <ol className="space-y-2.5 text-sm">
              {[
                "Raise your index finger to open the color palette — exactly 5 colors.",
                "Hold your fingertip on a color to pick it; the palette closes and that color is armed.",
                "Move your index finger across the slide to write in real time, right under your fingertip.",
                "Lower your index finger to stop — the stroke ends cleanly; raise it again to keep writing.",
                "Raise your index AND middle fingers together to open the eraser controls: Manual Eraser and Erase All.",
                "Pick Manual Eraser, then move your fingertip over your marks to rub out only what it passes over.",
                "Pick Erase All to remove every mark from the current slide at once.",
                "Writing is kept separately for each slide for the whole session; your PPT is never modified.",
              ].map((step, stepIndex) => (
                <li key={stepIndex} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border bg-secondary font-mono text-[11px] text-foreground">
                    {stepIndex + 1}
                  </span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
              No laser pointer is available in Master Write — the index finger is reserved for
              writing and never triggers a laser. Writing is a frontend overlay; your original
              PPT/PPTX is never modified.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
