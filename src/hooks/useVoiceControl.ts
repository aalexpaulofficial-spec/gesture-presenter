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
  one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, fore: 4,
  five: 5, six: 6, sex: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

const NUM_WORDS = Object.keys(WORDS_TO_NUM).join("|");

function toNumber(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (v in WORDS_TO_NUM) return WORDS_TO_NUM[v]!;
  return null;
}

const COLORS = ["yellow", "red", "green", "blue"];

function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:"'’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Speech-tolerance: fold common mis-recognitions into canonical wording. */
function canonicalise(text: string): string {
  return text
    .replace(/\b(nekst|nexts|neck's|nex|net)\b/g, "next")
    .replace(/\b(prev|pre|previews|previously|prevous|preview)\b/g, "previous")
    .replace(/\b(slides|slid|slyde|sled|slade)\b/g, "slide")
    .replace(/\b(hilight|highlite|high light|highlights?)\b/g, "highlight")
    .replace(/\b(clean|cleared|clears)\b/g, "clear")
    .replace(/\bgo to the\b/g, "go to the")
    .replace(/\bgoto\b/g, "go to")
    .replace(/\bgo two\b/g, "go to")
    .replace(/\bremoved\b/g, "remove")
    .trim();
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
    const lower = canonicalise(normalise(raw));
    if (!lower) return false;

    // Bare number → jump to that slide (highest priority).
    const bare = lower.match(new RegExp(`^(?:slide )?(\\d{1,3}|${NUM_WORDS})$`));
    if (bare?.[1]) {
      const n = toNumber(bare[1]);
      if (n != null) {
        return cb.onGoToSlide(n - 1) === false ? "slide_not_found" : true;
      }
    }

    // "go to slide 8" / "slide eight" / "jump to slide 8"
    const numbered = lower.match(
      new RegExp(`(?:go|jump|move|open|show)?\\s*(?:to\\s*)?slide\\s*(?:number\\s*)?(\\d{1,3}|${NUM_WORDS})`),
    );
    if (numbered?.[1]) {
      const n = toNumber(numbered[1]);
      if (n != null) {
        return cb.onGoToSlide(n - 1) === false ? "slide_not_found" : true;
      }
    }

    // Clear all highlights.
    if (/\bclear\b.*\bhighlight\b/.test(lower) || /\bremove all highlight\b/.test(lower)) {
      cb.onClearHighlights();
      return true;
    }

    // Remove a specific highlight.
    const remove = lower.match(/remove (?:the )?highlight (?:from |on |of )?(.+)/);
    if (remove?.[1]) {
      cb.onRemoveHighlight(remove[1].trim());
      return true;
    }

    // Highlight with a colour.
    const colored = lower.match(
      new RegExp(`highlight (?:the )?(.+?) (?:in|with|using) (${COLORS.join("|")})`),
    );
    if (colored?.[1] && colored[2]) {
      cb.onHighlight(colored[1].trim(), colored[2]);
      return true;
    }

    // Plain highlight.
    const highlight = lower.match(/highlight (?:the )?(.+)/);
    if (highlight?.[1]) {
      cb.onHighlight(highlight[1].trim(), "yellow");
      return true;
    }

    // Navigation.
    if (/\bnext\b/.test(lower) && /\bslide|page\b/.test(lower)) {
      cb.onNext();
      return true;
    }
    if (/^next$/.test(lower) || /\bnext slide\b/.test(lower)) {
      cb.onNext();
      return true;
    }
    if (
      /\bprevious\b/.test(lower) ||
      /\bgo back\b/.test(lower) ||
      /\bback slide\b/.test(lower) ||
      /^back$/.test(lower)
    ) {
      cb.onPrev();
      return true;
    }

    // Go to a slide by its text/title.
    const byText = lower.match(/go to (?:the )?(.+?) slide/);
    if (byText?.[1]) {
      cb.onGoToSlideByText(byText[1].trim());
      return true;
    }

    // Anything else is normal presentation speech — ignore it.
    return false;
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
      let final = "";
      let confidence = 1;
      const alternatives: string[] = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        if (result.isFinal) {
          final += result[0]?.transcript ?? "";
          if (typeof result[0]?.confidence === "number" && result[0].confidence > 0) {
            confidence = Math.min(confidence, result[0].confidence);
          }
          for (let a = 1; a < result.length; a++) {
            const alt = result[a]?.transcript;
            if (alt) alternatives.push(alt);
          }
        } else {
          interim += result[0]?.transcript ?? "";
        }
      }

      const speech = final || interim;
      if (speech) {
        setTranscript(speech.trim());
        if (!final) setStatus("recognizing");
      }

      if (!final.trim()) return;

      // Low-confidence results are still worth trying against strict command
      // patterns, but never surface an error for them.
      const confident = confidence >= thresholdRef.current;

      let outcome = processCommand(final);
      if (outcome === false) {
        for (const alt of alternatives) {
          const r = processCommand(alt);
          if (r !== false) {
            outcome = r;
            break;
          }
        }
      }

      if (outcome === "slide_not_found") flashStatus("slide_not_found");
      else if (outcome) flashStatus("executed");
      else if (confident) flashStatus("not_recognized");
      else setStatus("listening");
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

    safeStart();

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
