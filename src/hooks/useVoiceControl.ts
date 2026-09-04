import { useEffect, useRef, useState, useCallback } from "react";

export type VoiceHighlight = {
  id: string;
  text: string;
  color: string;
  box: { left: number; top: number; width: number; height: number };
};

/**
 * The compact three-state voice indicator shown to the presenter:
 *   green  → a supported command was actually executed
 *   yellow → listening / ready / initializing
 *   red    → permission denied, unsupported browser, or recognition error
 */
export type MicState = "green" | "yellow" | "red";

/**
 * Fine-grained recognition status. `micState` collapses this into the
 * green/yellow/red indicator; the UI shows it as the chip's text label.
 */
export type VoiceStatus =
  | "off"
  | "starting"
  | "listening"
  | "executed"
  | "slide_not_found"
  | "permission_denied"
  | "unsupported"
  | "error";

type UseVoiceControlProps = {
  enabled: boolean;
  /**
   * Master Voice keeps navigation strict ("next" / "previous" / a number).
   * Master Write / Master AI additionally allow the highlight and
   * "go to … slide" phrasings that are part of those plans.
   */
  extendedCommands?: boolean;
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

/**
 * Canonical spoken number words and compound numbers up to 100.
 * Chrome SpeechRecognition transcribes numbers as either digits ("4")
 * or words ("four").
 */
const WORDS_TO_NUM: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  for: 4, // Chrome speech recognition sometimes transcribes standalone "four" as "for"
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
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
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/**
 * Parses an utterance that is STRICTLY a number.
 * Returns null if the utterance contains any other words
 * (e.g. "today we have four points" -> null, "go to slide 4" -> null).
 */
function parseStrictNumber(str: string): number | null {
  const trimmed = str.trim().toLowerCase();
  if (!trimmed) return null;

  // Pure digits: "4", "5", "8", "15", "100"
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Single word number: "four", "eight", "fifteen", "twenty"
  if (trimmed in WORDS_TO_NUM) {
    const n = WORDS_TO_NUM[trimmed]!;
    return n > 0 ? n : null;
  }

  // Compound number word: "twenty-one", "twenty one", "thirty five"
  const parts = trimmed.replace(/-/g, " ").split(/\s+/);
  if (parts.length === 2) {
    const tens = WORDS_TO_NUM[parts[0]];
    const ones = WORDS_TO_NUM[parts[1]];
    if (tens && tens >= 20 && tens <= 90 && ones && ones >= 1 && ones <= 9) {
      return tens + ones;
    }
  }

  return null;
}

const COLORS = ["yellow", "red", "green", "blue"];

/**
 * A command that the utterance resolved to. Resolution is PURE — nothing is
 * executed until the dedup + confidence gates in the recognition handler pass.
 */
type ResolvedCommand =
  | { kind: "next" }
  | { kind: "prev" }
  | { kind: "slide"; n: number }
  | { kind: "highlight"; text: string; color: string }
  | { kind: "removeHighlight"; text: string }
  | { kind: "clearHighlights" }
  | { kind: "slideByText"; text: string };

/** Lowercase, strip harmless punctuation and collapse whitespace. */
function normalise(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:"'’“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Speech-tolerance for core command words: fold common long-range mis-recognitions.
 */
function canonicalise(text: string): string {
  return text
    .replace(/\b(nekst|nexts)\b/g, "next")
    .replace(/\b(prevs|prevous|previus)\b/g, "previous")
    .replace(/\b(hilight|highlite|high light|highlights?)\b/g, "highlight")
    .replace(/\b(clean|cleared|clears)\b/g, "clear")
    .replace(/\bremoved\b/g, "remove")
    .trim();
}

/**
 * STRICT command resolution.
 * - Bare "next" -> Next Slide
 * - Bare "previous" -> Previous Slide
 * - Strictly numeric command ("4", "5", "8", "four", etc.) -> Slide number
 * - "Highlight <text>" -> Highlight on current slide
 * - "Highlight <text> in <color>" -> Colored highlight
 * - "Remove Highlight <text>" -> Remove highlight
 * - "Clear Highlights" -> Clear all highlights
 *
 * Normal speech ("today we have four points", "India is an important market",
 * "go to slide 4", "please move to 4") returns null and executes nothing.
 */
function resolveCommand(raw: string, allowExtended = true): ResolvedCommand | null {
  const lower = canonicalise(normalise(raw));
  if (!lower) return null;

  // 1. Exact navigation: bare "next" / "previous" ONLY
  if (lower === "next") return { kind: "next" };
  if (lower === "previous") return { kind: "prev" };

  // 2. Direct numeric command: ONLY when utterance is purely a number
  // E.g. "4", "5", "8", "15", "four", "eight", "fifteen"
  // Will NOT match "today we have four points", "this is slide four", "go to slide 4"
  const numericVal = parseStrictNumber(lower);
  if (numericVal != null) {
    return { kind: "slide", n: numericVal };
  }

  // Also check if Chrome delivered with trailing punctuation like "4 ."
  const strippedPunct = lower.replace(/[^\w\d\s]/g, "").trim();
  if (strippedPunct !== lower) {
    const n = parseStrictNumber(strippedPunct);
    if (n != null) return { kind: "slide", n };
  }

  // 3. Clear all highlights: "clear highlights", "clear highlight", "clear all highlights"
  if (/^(?:clear|clear all|remove all|remove every)\s+highlights?$/.test(lower)) {
    return { kind: "clearHighlights" };
  }

  // 4. Remove a specific highlight: "remove highlight india"
  const removeMatch = lower.match(/^remove\s+(?:the\s+)?highlight\s+(?:from\s+|on\s+|of\s+)?(.+)$/);
  if (removeMatch?.[1]) {
    const t = removeMatch[1].trim();
    if (t) return { kind: "removeHighlight", text: t };
  }

  // 5. Highlight with color: "highlight india in red|yellow|green|blue"
  const coloredMatch = lower.match(
    /^highlight\s+(?:the\s+)?(.+?)\s+(?:in|with|using)\s+(yellow|red|green|blue)$/,
  );
  if (coloredMatch?.[1] && coloredMatch[2]) {
    const t = coloredMatch[1].trim();
    if (t) return { kind: "highlight", text: t, color: coloredMatch[2] };
  }

  // 6. Plain highlight: "highlight india"
  const plainMatch = lower.match(/^highlight\s+(?:the\s+)?(.+)$/);
  if (plainMatch?.[1]) {
    const t = plainMatch[1].trim();
    if (t) return { kind: "highlight", text: t, color: "yellow" };
  }

  // Optional: Extended plan title search: "go to the introduction slide"
  if (allowExtended) {
    const byText = lower.match(/^go to (?:the )?(.+?) slide$/);
    if (byText?.[1]) {
      return { kind: "slideByText", text: byText[1].trim() };
    }
  }

  // Ordinary speech -> DO NOTHING
  return null;
}

function micStateFor(status: VoiceStatus, supported: boolean): MicState {
  switch (status) {
    // A supported command was actually executed → GREEN.
    case "executed":
    case "slide_not_found":
      return "green";
    // Listening / ready / initializing → YELLOW.
    case "starting":
    case "listening":
      return "yellow";
    // Unavailable, denied, failed, or not yet started → RED.
    case "off":
    case "permission_denied":
    case "unsupported":
    case "error":
      return "red";
  }
}

export function useVoiceControl({
  enabled,
  extendedCommands = true,
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
  const [status, setStatus] = useState<VoiceStatus>("off");

  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const extendedRef = useRef(extendedCommands);
  extendedRef.current = extendedCommands;
  const thresholdRef = useRef(confidenceThreshold);
  thresholdRef.current = confidenceThreshold;
  const stoppingRef = useRef(false);
  // Guards against one spoken command running twice when an engine re-delivers
  // the same final result around an auto-restart.
  const lastRunRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

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

  /**
   * Resolve + gate + execute one FINAL utterance. Only final results reach
   * this function — interim/partial phrases never execute commands.
   */
  const runCommand = useCallback(
    (text: string, confidence: number, alternatives: string[]): boolean | "slide_not_found" => {
      if (!enabledRef.current || stoppingRef.current) return false;

      const cb = callbacksRef.current;
      const confident = !(confidence > 0 && confidence < thresholdRef.current);

      let cmd = resolveCommand(text, extendedRef.current);

      // Numeric commands, highlight commands, and exact navigation words are strictly
      // parsed whole-utterance commands. Chrome's Web Speech API routinely reports
      // 0 or near-0 confidence for short single words/numbers. They should not be
      // discarded by confidence gate.
      const isStrictCommand =
        cmd?.kind === "slide" ||
        cmd?.kind === "highlight" ||
        cmd?.kind === "removeHighlight" ||
        cmd?.kind === "clearHighlights" ||
        cmd?.kind === "next" ||
        cmd?.kind === "prev";

      if (cmd && !confident && !isStrictCommand) cmd = null;

      // If the primary transcript did not resolve to a command, try alternatives
      if (!cmd) {
        for (const alt of alternatives) {
          const r = resolveCommand(alt, extendedRef.current);
          if (r) {
            cmd = r;
            break;
          }
        }
      }

      if (!cmd) return false;

      // Deduplication: one spoken command runs exactly once, even if the
      // engine re-delivers the same final result across an auto-restart.
      const key = normalise(text);
      const now = Date.now();
      if (lastRunRef.current.key === key && now - lastRunRef.current.at < 1000) return false;
      lastRunRef.current = { key, at: now };

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
    },
    [],
  );

  useEffect(() => {
    if (!supported) {
      setStatus("unsupported");
      return;
    }

    // Disabled (wrong plan/phase): stop the engine and drop every handler.
    if (!enabled) {
      stoppingRef.current = true;
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.onstart = null;
          rec.onaudiostart = null;
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          rec.abort?.();
        } catch {
          /* ignore */
        }
      }
      recognitionRef.current = null;
      setIsListening(false);
      setStatus("off");
      return;
    }

    // Microphone starts AUTOMATICALLY when the plan is active — no manual
    // toggle. Permission is requested once, here; a denial surfaces as RED.
    stoppingRef.current = false;
    let restartTimer: number | null = null;
    let watchdog: number | null = null;
    let settledTimer: number | null = null;
    let lastActivity = Date.now();
    let disposed = false;

    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new Ctor();
    // Continuous + interim keeps recognition responsive while the presenter
    // stands away from the device. Only FINAL results execute commands.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 3;
    recognitionRef.current = recognition;

    // Return the chip to YELLOW ("listening") shortly after a command runs.
    const settleToYellow = () => {
      if (settledTimer) window.clearTimeout(settledTimer);
      settledTimer = window.setTimeout(() => {
        if (enabledRef.current && !stoppingRef.current) setStatus("listening");
      }, 1400);
    };

    const safeStart = () => {
      if (stoppingRef.current || !enabledRef.current) return;
      try {
        recognition.start();
      } catch {
        /* already started — never create a second instance */
      }
    };

    // Ask for the microphone up-front so a denial surfaces immediately as RED
    // instead of a silent recognition failure later. The track is stopped
    // right away — the CameraWindow keeps its own stream. Recognition itself
    // re-uses the granted permission; permission is never re-requested.
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
        }
        // Interim/partial phrases are intentionally ignored — they never
        // execute commands and never change the status indicator.
      }

      if (!finals.length) return;

      for (const { text, confidence, alternatives } of finals) {
        if (!text.trim()) continue;
        const outcome = runCommand(text, confidence, alternatives);
        // GREEN only when a supported command actually ran. Ordinary speech
        // ("Hello everyone", "This is the next topic") never flashes green.
        if (outcome === "slide_not_found") {
          setStatus("slide_not_found");
          settleToYellow();
        } else if (outcome) {
          setStatus("executed");
          settleToYellow();
        }
        // Non-command speech → status stays YELLOW. Silent, by design.
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
      // network / audio-capture etc. → retry shortly, back to yellow
      setStatus("error");
      restartTimer = window.setTimeout(safeStart, 1200);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (stoppingRef.current || !enabledRef.current) return;
      // Automatic restart keeps listening continuous across browser timeouts.
      restartTimer = window.setTimeout(safeStart, 300);
    };

    void permissionCheck?.then(() => {
      if (!disposed && enabledRef.current && !stoppingRef.current) {
        setStatus("starting");
        safeStart();
      }
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
      if (settledTimer) window.clearTimeout(settledTimer);
      try {
        recognition.onstart = null;
        recognition.onaudiostart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };
  }, [enabled, supported, runCommand]);

  const micState = micStateFor(status, supported);

  return { supported, micState, isListening, status };
}
