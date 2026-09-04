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
 * Canonical spoken number words. Deliberately conservative: homophones like
 * "to"/"too"/"for"/"ate"/"won" are normal presentation words, so folding them
 * onto slide numbers would navigate on ordinary speech. "Sixteen"/"seventeen"
 * etc. are safe to keep — they are unambiguous numbers, never ordinary words.
 */
const WORDS_TO_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
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
 * Speech-tolerance: fold common long-range mis-recognitions into canonical
 * wording. Only single-word folds toward the two command words are safe — a
 * fold that maps unrelated words onto "next"/"previous" would create false
 * triggers. Deliberately conservative. Word-boundary matching means
 * "next-generation" and "previously" can never fold or match.
 */
function canonicalise(text: string): string {
  return text
    .replace(/\b(nekst|nexts)\b/g, "next")
    .replace(/\b(prevs|prevous|previus)\b/g, "previous")
    .replace(/\b(slides|slid)\b/g, "slide")
    .replace(/\b(hilight|highlite|high light|highlights?)\b/g, "highlight")
    .replace(/\b(clean|cleared|clears)\b/g, "clear")
    .replace(/\bgoto\b/g, "go to")
    .replace(/\bremoved\b/g, "remove")
    .trim();
}

/**
 * STRICT command resolution. The WHOLE utterance must be exactly the command —
 * any extra words ("next slide", "please next", "go to 6", "I said next")
 * return null and nothing happens. With `allowExtended` false (Master Voice)
 * the only supported commands are exactly: "next", "previous", and a bare
 * number / number word.
 */
function resolveCommand(raw: string, allowExtended: boolean): ResolvedCommand | null {
  const lower = canonicalise(normalise(raw));
  if (!lower) return null;

  // Exact navigation: only a bare "next" / "previous".
  if (lower === "next") return { kind: "next" };
  if (lower === "previous") return { kind: "prev" };

  // Whole utterance is a number: "8", "eight". NOT "slide 8" / "go to 6".
  const bare = lower.match(new RegExp(`^(\\d{1,2}|${NUM_WORDS})$`));
  if (bare?.[1]) {
    const n = toNumber(bare[1]);
    if (n != null) return { kind: "slide", n };
  }

  if (!allowExtended) return null;

  // Extended plans only: "slide 8" / "slide number 8" / "go to slide 8".
  const numbered = lower.match(
    new RegExp(
      `^(?:go|jump|move|show|open)?\\s*(?:to\\s+)?(?:the\\s+)?slide\\s*(?:number\\s*)?(\\d{1,3}|${NUM_WORDS})$`,
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

      // Strict gate: exact commands (next / previous / bare numbers) only run
      // when the engine is confident. Weak-hearing misfires are worse than a
      // missed command during a talk.
      if (cmd && !confident) cmd = null;

      // Only if the primary transcript resolved nothing do we try the engine's
      // alternatives — they face the same confidence gate.
      if (!cmd && confident) {
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
