import { useEffect, useRef, useState, useCallback } from "react";

export type VoiceHighlight = {
  id: string;
  text: string;
  color: string;
  box: { left: number; top: number; width: number; height: number };
};

export type VoiceStatus =
  | "idle"
  | "listening"
  | "recognizing"
  | "executed"
  | "not_recognized"
  | "slide_not_found"
  | "permission_denied"
  | "error";

type UseVoiceControlProps = {
  enabled: boolean;
  /** Minimum recognition confidence (0-1) required for a final result to run. */
  confidenceThreshold?: number;
  onNext: () => void;
  onPrev: () => void;
  onGoToSlide: (slide: number) => boolean | void;
  onHighlight: (text: string, color: string) => void;
  onRemoveHighlight: (text: string) => void;
  onClearHighlights: () => void;
  onGoToSlideByText: (text: string) => void;
};

const WORDS_TO_NUM: Record<string, number> = {
  one: 1,
  won: 1,
  two: 2,
  to: 2,
  too: 2,
  three: 3,
  tree: 3,
  four: 4,
  for: 4,
  fore: 4,
  five: 5,
  six: 6,
  sex: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const NUM_WORDS = Object.keys(WORDS_TO_NUM).join("|");

function toNumber(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (v in WORDS_TO_NUM) return WORDS_TO_NUM[v]!;
  return null;
}

const COLORS = ["yellow", "red", "green", "blue"];

/**
 * A command that the utterance resolved to. Resolution is PURE — nothing is
 * executed until the confidence gate in the recognition handler passes.
 */
type ResolvedCommand =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "slide"; n: number }
  | { kind: "highlight"; text: string; color: string }
  | { kind: "removeHighlight"; text: string }
  | { kind: "clearHighlights" }
  | { kind: "slideByText"; text: string };

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:"'’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speech-tolerance: fold common mis-recognitions into canonical wording.
 * Only single-word folds are safe here — navigation matching is exact, so a
 * fold that maps unrelated words onto "next"/"previous" would create false
 * triggers. Keep this list conservative.
 */
function canonicalise(text: string): string {
  return text
    .replace(/\b(nekst|nexts|neck's|nex)\b/g, "next")
    .replace(/\b(prev|previews|prevous|preveous)\b/g, "previous")
    .replace(/\b(slides|slid|slyde|sled|slade)\b/g, "slide")
    .replace(/\b(hilight|highlite|high light|highlights?)\b/g, "highlight")
    .replace(/\b(clean|cleared|clears)\b/g, "clear")
    .replace(/\bgoto\b/g, "go to")
    .replace(/\bremoved\b/g, "remove")
    .trim();
}

/**
 * Strict command resolution. The WHOLE utterance must resolve to a command —
 * a sentence that merely contains the word "next" (or a number) never
 * triggers anything.
 */
function resolveCommand(raw: string): ResolvedCommand | null {
  const lower = canonicalise(normalise(raw));
  if (!lower) return null;

  // Exact navigation: only a bare "next" / "next slide" / "previous" / "previous slide".
  if (/^(?:next|next slide|next one)$/.test(lower)) return { kind: "next" };
  if (/^(?:previous|previous slide|back one)$/.test(lower)) return { kind: "prev" };

  // Whole utterance is a number: "4", "four", "slide 4", "slide number 8".
  const bare = lower.match(new RegExp(`^(?:slide |slide number )?(\\d{1,3}|${NUM_WORDS})$`));
  if (bare?.[1]) {
    const n = toNumber(bare[1]);
    if (n != null) return { kind: "slide", n };
  }

  // "go to slide 8" / "jump to slide 8" / "go to the eighth slide" — anchored.
  const numbered = lower.match(
    new RegExp(
      `^(?:go|jump|move|show|open)\\s+(?:to\\s+)?(?:the\\s+)?slide\\s*(?:number\\s*)?(\\d{1,3}|${NUM_WORDS})$`,
    ),
  );
  if (numbered?.[1]) {
    const n = toNumber(numbered[1]);
    if (n != null) return { kind: "slide", n };
  }

  // Clear all highlights.
  if (/^(?:clear|clear all|remove all|remove every)(?: the)? highlights?$/.test(lower)) {
    return { kind: "clearHighlights" };
  }

  // Remove a specific highlight: "remove highlight india".
  const remove = lower.match(/^remove (?:the )?highlight (?:from |on |of )?(.+)$/);
  if (remove?.[1]) {
    return { kind: "removeHighlight", text: remove[1].trim() };
  }

  // Highlight with a colour: "highlight india in red".
  const colored = lower.match(
    new RegExp(`^highlight (?:the )?(.+?) (?:in|with|using) (${COLORS.join("|")})$`),
  );
  if (colored?.[1] && colored[2]) {
    return { kind: "highlight", text: colored[1].trim(), color: colored[2] };
  }

  // Plain highlight: "highlight india".
  const highlight = lower.match(/^highlight (?:the )?(.+)$/);
  if (highlight?.[1]) {
    return { kind: "highlight", text: highlight[1].trim(), color: "yellow" };
  }

  // Go to a slide by its text/title: "go to the introduction slide".
  const byText = lower.match(/^go to (?:the )?(.+?) slide$/);
  if (byText?.[1]) {
    return { kind: "slideByText", text: byText[1].trim() };
  }

  // Anything else is normal presentation speech — ignore it.
  return null;
}

export function useVoiceControl({
  enabled,
  confidenceThreshold = 0.4,
  onNext,
  onPrev,
  onGoToSlide,
  onHighlight,
  onRemoveHighlight,
  onClearHighlights,
  onGoToSlideByText,
}: UseVoiceControlProps) {
  const [supported, setSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<VoiceStatus>("idle");

  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const thresholdRef = useRef(confidenceThreshold);
  thresholdRef.current = confidenceThreshold;
  const stoppingRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  const callbacksRef = useRef({
    onNext,
    onPrev,
    onGoToSlide,
    onHighlight,
    onRemoveHighlight,
    onClearHighlights,
    onGoToSlideByText,
  });
  callbacksRef.current = {
    onNext,
    onPrev,
    onGoToSlide,
    onHighlight,
    onRemoveHighlight,
    onClearHighlights,
    onGoToSlideByText,
  };

  useEffect(() => {
    const Ctor =
      typeof window !== "undefined"
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : undefined;
    setSupported(Boolean(Ctor));
  }, []);

  const processCommand = useCallback((raw: string): boolean | "slide_not_found" => {
    const cb = callbacksRef.current;
    const cmd = resolveCommand(raw);
    if (!cmd) return false;
    switch (cmd.kind) {
      case "next":
        cb.onNext();
        return true;
      case "prev":
        cb.onPrev();
        return true;
      case "slide":
        return cb.onGoToSlide(cmd.n - 1) === false ? "slide_not_found" : true;
      case "highlight":
        cb.onHighlight(cmd.text, cmd.color);
        return true;
      case "removeHighlight":
        cb.onRemoveHighlight(cmd.text);
        return true;
      case "clearHighlights":
        cb.onClearHighlights();
        return true;
      case "slideByText":
        cb.onGoToSlideByText(cmd.text);
        return true;
    }
  }, []);

  useEffect(() => {
    if (!supported) return;

    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!enabled) {
      stoppingRef.current = true;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
      setIsListening(false);
      setStatus("idle");
      setTranscript("");
      return;
    }

    stoppingRef.current = false;
    let restartTimer: number | null = null;
    let watchdog: number | null = null;
    let lastActivity = Date.now();
    let disposed = false;

    // Ask for the microphone up-front so a denial surfaces immediately as
    // "Permission denied" instead of a silent recognition failure later.
    // The track is stopped right away — the CameraWindow keeps its own stream.
    let permissionCheck: Promise<void> | null = null;
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      permissionCheck = navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          for (const track of stream.getTracks()) track.stop();
        })
        .catch(() => {
          if (!disposed) {
            setStatus("permission_denied");
            setIsListening(false);
            stoppingRef.current = true;
          }
        });
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;

    const flashStatus = (next: VoiceStatus) => {
      setStatus(next);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        if (enabledRef.current) setStatus("listening");
      }, 2000);
    };

    const safeStart = () => {
      if (stoppingRef.current || !enabledRef.current) return;
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    };

    recognition.onstart = () => {
      lastActivity = Date.now();
      setIsListening(true);
      setStatus("listening");
    };

    recognition.onaudiostart = () => {
      lastActivity = Date.now();
    };

    recognition.onresult = (event: any) => {
      lastActivity = Date.now();
      let interim = "";
      const finals: Array<{ text: string; confidence: number; alternatives: string[] }> = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) {
          const alt: string[] = [];
          for (let a = 1; a < result.length; a++) {
            const t = result[a]?.transcript;
            if (t) alt.push(t);
          }
          finals.push({
            text: result[0]?.transcript ?? "",
            confidence:
              typeof result[0]?.confidence === "number" && result[0].confidence > 0
                ? result[0].confidence
                : 1,
            alternatives: alt,
          });
        } else {
          interim += result[0]?.transcript ?? "";
        }
      }

      const speech = finals.map((f) => f.text).join(" ") || interim;
      if (speech) {
        setTranscript(speech.trim());
        if (!finals.length) setStatus("recognizing");
      }

      if (!finals.length) return;

      for (const { text, confidence, alternatives } of finals) {
        if (!text.trim()) continue;

        let outcome = processCommand(text);

        // Strict gate: exact commands (next / previous / bare numbers) only
        // run when the engine is confident. Weak-hearing misfires are worse
        // than a missed command during a talk.
        if (outcome !== false && confidence < thresholdRef.current) {
          outcome = false;
        }

        // Only if the primary transcript resolved nothing do we try the
        // engine's alternatives — and they face the same confidence gate.
        if (outcome === false) {
          for (const alt of alternatives) {
            const r = processCommand(alt);
            if (r !== false && confidence >= thresholdRef.current) {
              outcome = r;
              break;
            }
          }
        }

        if (outcome === "slide_not_found") flashStatus("slide_not_found");
        else if (outcome) flashStatus("executed");
        else if (confidence >= thresholdRef.current) flashStatus("not_recognized");
        else setStatus("listening");
      }
    };

    recognition.onerror = (event: any) => {
      const err = event?.error;
      if (err === "no-speech" || err === "aborted") return; // silence, keep going
      if (err === "not-allowed" || err === "service-not-allowed" || err === "permission-denied") {
        setStatus("permission_denied");
        setIsListening(false);
        stoppingRef.current = true;
        return;
      }
      // network / audio-capture etc. → retry shortly
      setStatus("error");
      restartTimer = window.setTimeout(safeStart, 1200);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (stoppingRef.current || !enabledRef.current) {
        setStatus("idle");
        return;
      }
      // Automatic restart keeps listening continuous across browser timeouts.
      restartTimer = window.setTimeout(safeStart, 350);
    };

    void permissionCheck?.then(() => {
      if (!disposed && enabledRef.current && !stoppingRef.current) safeStart();
    });

    // Watchdog: some browsers silently stop delivering audio events.
    watchdog = window.setInterval(() => {
      if (!enabledRef.current || stoppingRef.current) return;
      if (Date.now() - lastActivity > 12000) {
        lastActivity = Date.now();
        try {
          recognition.stop(); // onend restarts it
        } catch {
          safeStart();
        }
      }
    }, 5000);

    return () => {
      disposed = true;
      stoppingRef.current = true;
      if (restartTimer) window.clearTimeout(restartTimer);
      if (watchdog) window.clearInterval(watchdog);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      try {
        recognition.onend = null;
        recognition.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, [enabled, supported, processCommand]);

  return { supported, isListening, transcript, status };
}
