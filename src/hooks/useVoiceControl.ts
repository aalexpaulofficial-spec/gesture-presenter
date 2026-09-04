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
  /** Returns false when no slide matches the spoken title. */
  onGoToSlideByText: (text: string) => boolean | void;
};

/**
 * Canonical spoken number words and compound numbers up to 100.
 * Chrome SpeechRecognition transcribes numbers as either digits ("4")
 * or words ("four"), and it is not consistent between utterances.
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

  // Spellings Chrome actually returns for a spoken standalone digit. Apart
  // from the pre-existing "for", every entry here is a non-word: mapping a
  // real English word would move the deck in the middle of a sentence.
  fore: 4,
  faur: 4,
  hive: 5,
  fife: 5,
  siks: 6,
  sevin: 7,
  ate: 8,
  ait: 8,
  eit: 8,
  nain: 9,
  nyne: 9,
  tin: 10,
  tenn: 10,
  elevin: 11,
  twelv: 12,
  forteen: 14,
  fiveteen: 15,
  fifthteen: 15,
  eightteen: 18,
  ninteen: 19,
  fourty: 40,
};

/**
 * Ordinals map to the same slide as the cardinal ("eighth" → slide 8).
 * "first" / "second" / "third" are deliberately absent — they collide with
 * ordinary narration ("first of all", "second point", "a third of users").
 */
const ORDINAL_WORDS_TO_NUM: Record<string, number> = {
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  thirtieth: 30,
  fortieth: 40,
  fiftieth: 50,
  sixtieth: 60,
  seventieth: 70,
  eightieth: 80,
  ninetieth: 90,
  hundredth: 100,
};

/** Canonical single-digit cardinals — the only words allowed in a digit run. */
const CARDINAL_UNITS = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
]);

/**
 * Discourse noise Chrome bundles into a short utterance ("okay 8", "um four",
 * "8 please"). Stripped only from the ENDS of an utterance that is otherwise
 * nothing but a number, so ordinary sentences can never be reduced to one.
 */
const LEADING_FILLERS = new Set([
  "ok",
  "okay",
  "okey",
  "alright",
  "so",
  "and",
  "now",
  "then",
  "well",
  "um",
  "uh",
  "er",
  "ah",
  "oh",
  "hmm",
  "right",
  "yeah",
  "yep",
  "please",
  "kindly",
  "hey",
]);

const TRAILING_FILLERS = new Set(["please", "now", "thanks", "ok", "okay"]);

/**
 * Symbols that change what a number means. "50%", "$5", "4/5" and "3 x 4" are
 * speech about numbers, never a request for slide 50, 5, 4 or 3.
 */
const NUMBER_HOSTILE_SYMBOLS = /[%$€£¥₹°+=/\\*<>~^&@]/;

function isTensMultiple(value: number): boolean {
  return value >= 20 && value <= 90 && value % 10 === 0;
}

/** A token that may take part in a spelled-out digit run: "1", "one". */
function isUnitToken(token: string): boolean {
  return /^\d$/.test(token) || CARDINAL_UNITS.has(token);
}

/** Numeric value of a single token, or null when the token is not a number. */
function tokenValue(token: string): number | null {
  if (/^\d{1,3}$/.test(token)) return parseInt(token, 10);

  const digitOrdinal = token.match(/^(\d{1,3})(?:st|nd|rd|th)$/);
  if (digitOrdinal?.[1]) return parseInt(digitOrdinal[1], 10);

  const cardinal = WORDS_TO_NUM[token];
  if (typeof cardinal === "number") return cardinal;

  const ordinal = ORDINAL_WORDS_TO_NUM[token];
  if (typeof ordinal === "number") return ordinal;

  return null;
}

/**
 * Splits an utterance into number tokens, or returns null when it contains
 * anything that disqualifies it from being read as a number.
 */
function numberTokens(input: string): string[] | null {
  if (NUMBER_HOSTILE_SYMBOLS.test(input)) return null;

  const cleaned = input
    .replace(/[.,!?;:"'’“”\-–—()[\]{}#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/^[a-z0-9 ]+$/.test(cleaned)) return null;

  // Re-join an ordinal suffix Chrome split off: "8 th" → "8th".
  const merged: string[] = [];
  for (const token of cleaned.split(" ")) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && /^\d{1,3}$/.test(prev) && /^(?:st|nd|rd|th)$/.test(token)) {
      merged[merged.length - 1] = prev + token;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

function stripFillers(tokens: string[]): string[] {
  let start = 0;
  let end = tokens.length;
  for (let i = 0; i < 2 && start < end; i++) {
    const token = tokens[start];
    if (token === undefined || !LEADING_FILLERS.has(token)) break;
    start++;
  }
  for (let i = 0; i < 2 && end > start; i++) {
    const token = tokens[end - 1];
    if (token === undefined || !TRAILING_FILLERS.has(token)) break;
    end--;
  }
  return tokens.slice(start, end);
}

/**
 * Turns number tokens into one slide number.
 *
 * Two different multi-token rules exist and must not be confused:
 *   a run of single digits CONCATENATES  — "1 0" → 10, "1 0 0" → 100
 *   tens + ones ADDS                     — "twenty one" → 21, "40 4" → 44
 */
function tokensToNumber(input: string[]): number | null {
  let tokens = input.filter((token) => token !== "and");
  // "a hundred" reads as "one hundred"; "a" is never a number by itself.
  if (tokens[0] === "a" && tokens[1] === "hundred") tokens = ["one", ...tokens.slice(1)];
  if (!tokens.length || tokens.length > 3) return null;

  const values: number[] = [];
  for (const token of tokens) {
    const value = tokenValue(token);
    if (value === null) return null;
    values.push(value);
  }

  const inRange = (n: number): number | null => (n > 0 && n <= 999 ? n : null);

  if (values.length === 1) return inRange(values[0]!);

  // "one hundred", "one hundred five", "hundred twenty one"
  const hundredAt = tokens.indexOf("hundred");
  if (hundredAt !== -1) {
    if (hundredAt > 1) return null;
    const multiplier = hundredAt === 0 ? 1 : values[0]!;
    if (multiplier < 1 || multiplier > 9) return null;
    const rest = values.slice(hundredAt + 1);
    let total = multiplier * 100;
    if (rest.length === 1) {
      total += rest[0]!;
    } else if (rest.length === 2) {
      const tens = rest[0]!;
      const ones = rest[1]!;
      if (!isTensMultiple(tens) || ones < 1 || ones > 9) return null;
      total += tens + ones;
    } else if (rest.length > 2) {
      return null;
    }
    return inRange(total);
  }

  if (values.length === 2) {
    const first = values[0]!;
    const second = values[1]!;
    if (isTensMultiple(first) && second >= 1 && second <= 9) return inRange(first + second);
    if (isUnitToken(tokens[0]!) && isUnitToken(tokens[1]!)) return inRange(first * 10 + second);
    return null;
  }

  // Three tokens: only a pure digit run ("1 0 0" → 100).
  if (tokens.every((token) => /^\d$/.test(token))) {
    return inRange(values[0]! * 100 + values[1]! * 10 + values[2]!);
  }
  return null;
}

/**
 * Parses an utterance that is NOTHING BUT a number (fillers aside).
 * Returns null the moment any other word is present, so
 * "today we have four points" and "this slide has eight points" stay inert.
 */
function parseStandaloneNumber(text: string): number | null {
  const tokens = numberTokens(text);
  if (!tokens) return null;
  return tokensToNumber(stripFillers(tokens));
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
 * Only non-words are folded here, because this rewrite also applies to highlight
 * and slide-title payloads.
 */
function canonicalise(text: string): string {
  return text
    .replace(/\b(nekst|nexts|necst|nexr)\b/g, "next")
    .replace(/\b(prevs|prevous|previus|previos|prevoius|pervious)\b/g, "previous")
    .replace(/\b(hilight|highlite|high light|highlights?)\b/g, "highlight")
    .replace(/\b(clean|cleared|clears)\b/g, "clear")
    .replace(/\bremoved\b/g, "remove")
    .trim();
}

/**
 * Mis-recognitions that are only safe to fold when they are the ENTIRE
 * utterance. "text", "nest" and "preview" are ordinary words, so folding them
 * at word level would corrupt highlight payloads and normal speech.
 */
const WHOLE_UTTERANCE_FOLDS: Record<string, string> = {
  "text slide": "next slide",
  "nest slide": "next slide",
  "necks slide": "next slide",
  "next slade": "next slide",
  "next slid": "next slide",
  previews: "previous",
  preview: "previous",
  "previous slade": "previous slide",
};

/* ------------------------------------------------------------------ *
 * Natural-phrase navigation
 *
 * Every pattern is anchored at BOTH ends, so only a WHOLE utterance can
 * navigate. That anchoring is the safety property: "the details are on the
 * next slide" ends with "next slide" and "the next slide shows our pricing"
 * begins with it, yet neither can ever match. Each vocabulary below is a
 * closed list for the same reason — "next up", "next question" and
 * "let us go to the next section" must stay inert.
 * ------------------------------------------------------------------ */

/** Discourse openers: "ok next", "so previous slide". */
const OPENER =
  "(?:ok|okay|okey|alright|all right|so|and|now|then|well|um|uh|er|ah|oh|hmm|right|yeah|yep|please|kindly|hey|hi)";

/**
 * Subject / modal run before the verb. `normalise` turns apostrophes into a
 * space, so "let's" arrives as "let s" and "I'm" as "i m" — both spellings
 * are listed.
 */
const SUBJECT =
  "(?:let s|let us|lets|let me|can we|can you|can i|could we|could you|would you|will you|shall we|" +
  "i want to|i would like to|i d like to|we will|we shall|we are going to|we re going to|" +
  "i am going to|i m going to|you can)";

/** Movement verbs. Deliberately excludes "go ahead", which is normal speech. */
const MOVE =
  "(?:go|goto|move|moving on|moving|going|jump|skip|advance|continue|proceed|switch|flip|scroll|" +
  "navigate|change|take me|bring me|show me|show|display|give me|open|pull up|bring up)";

/** Prepositions allowed AFTER a movement verb. */
const VERB_PREP = "(?:to|on to|onto|over to|forward to|back to|towards|toward|up to)";

/**
 * Prepositions allowed with NO verb ("to the next slide"). Restricted on
 * purpose: bare "on"/"in"/"at" would let "on the next slide" navigate.
 */
const LEAD_PREP = "(?:to|on to|onto|over to)";

const DET = "(?:the|a|my|this|that|your|our)";

/** Closed noun list — anything else after "next"/"previous" is not a slide. */
const NOUN = "(?:slide|slides|page|pages|one|screen|frame)";

const TAIL = "(?:please|now|thanks|thank you|for me|for us)";

const PREFIX_RUN =
  `(?:${OPENER}\\s+){0,2}(?:${SUBJECT}\\s+)?` +
  `(?:${MOVE}(?:\\s+${VERB_PREP})?\\s+|${LEAD_PREP}\\s+)?(?:${DET}\\s+)?`;

/** "next", "next slide", "go to the next slide", "let s go to the next slide". */
const NEXT_PHRASE = new RegExp(`^${PREFIX_RUN}next(?:\\s+${NOUN})?(?:\\s+${TAIL})?$`);

/** The same shapes for "previous". */
const PREV_PHRASE = new RegExp(`^${PREFIX_RUN}previous(?:\\s+${NOUN})?(?:\\s+${TAIL})?$`);

/**
 * "go back", "back one slide". Bare "back" is NOT a command: it finalises out
 * of ordinary speech far too often ("back in 2019", "back to the point").
 */
const BACK_PHRASE = new RegExp(
  `^(?:${OPENER}\\s+){0,2}(?:${SUBJECT}\\s+)?` +
    `(?:${MOVE}\\s+back(?:\\s+(?:one|1|a)\\s+${NOUN})?|back\\s+(?:one|1|a)\\s+${NOUN})` +
    `(?:\\s+${TAIL})?$`,
);

/** "go forward", "forward one slide". Bare "forward" is likewise excluded. */
const FORWARD_PHRASE = new RegExp(
  `^(?:${OPENER}\\s+){0,2}(?:${SUBJECT}\\s+)?` +
    `(?:(?:go|move|jump|skip|scroll|step)\\s+forward(?:\\s+(?:one|1|a)\\s+${NOUN})?` +
    `|forward\\s+(?:one|1|a)\\s+${NOUN})` +
    `(?:\\s+${TAIL})?$`,
);

/** "slide 8", "go to slide 8", "page eight", "number 8" — whole utterance only. */
const NUMBER_PREFIX_PHRASE = new RegExp(
  `^${PREFIX_RUN}(?:slide number|page number|slide|page|number)\\s+(.+?)(?:\\s+${TAIL})?$`,
);

/** "the eighth slide", "4th slide", "go to the fourth page". */
const ORDINAL_SLIDE_PHRASE = new RegExp(
  `^${PREFIX_RUN}([a-z0-9]+)\\s+(?:slide|page)(?:\\s+${TAIL})?$`,
);

/**
 * STRICT command resolution — pure, executes nothing.
 *
 * Priority, per the Master Voice spec:
 *   1. NEXT      — "next", "next slide", "go to the next slide", "go forward"
 *   2. PREVIOUS  — the same shapes plus "go back", "back one slide"
 *   3. A STANDALONE number — "8", "eight", "8th", "okay 8", "twenty one"
 *   4. A number behind a slide/page/number prefix — "slide 8", "the 8th slide"
 *   5. The existing highlight / clear commands
 *   6. The existing "go to <title> slide" title search
 *   7. Anything else — nothing happens
 *
 * Ordinary speech ("hello everyone", "today we will discuss five topics",
 * "this slide has eight points", "please explain slide five", "the next
 * quarter looks strong") resolves to null and executes nothing.
 */
function resolveCommand(raw: string, allowExtended = true): ResolvedCommand | null {
  const normalised = normalise(raw);
  const folded = WHOLE_UTTERANCE_FOLDS[normalised] ?? normalised;
  const lower = canonicalise(folded);
  if (!lower) return null;

  // 1. NEXT — exact word first so the pre-existing behaviour can never regress.
  if (lower === "next") return { kind: "next" };
  // 2. PREVIOUS
  if (lower === "previous") return { kind: "prev" };

  // 1b / 2b. Natural phrasings. These run before every other rule because the
  // title-search rule below would otherwise swallow "go to the next slide".
  if (NEXT_PHRASE.test(lower) || FORWARD_PHRASE.test(lower)) return { kind: "next" };
  if (PREV_PHRASE.test(lower) || BACK_PHRASE.test(lower)) return { kind: "prev" };

  // 3. A standalone number: "4", "8", "eight", "ate", "8th", "okay 8", "1 0".
  const standalone = parseStandaloneNumber(lower);
  if (standalone !== null) return { kind: "slide", n: standalone };

  // 4. Highlight commands keep their existing priority over the prefixed
  //    number forms so "highlight slide 4" still highlights.
  //    Clear all highlights: "clear highlights", "clear all highlights".
  if (/^(?:clear|clear all|remove all|remove every)\s+highlights?$/.test(lower)) {
    return { kind: "clearHighlights" };
  }

  // Remove a specific highlight: "remove highlight india"
  const removeMatch = lower.match(/^remove\s+(?:the\s+)?highlight\s+(?:from\s+|on\s+|of\s+)?(.+)$/);
  if (removeMatch?.[1]) {
    const t = removeMatch[1].trim();
    if (t) return { kind: "removeHighlight", text: t };
  }

  // Highlight with color: "highlight india in red|yellow|green|blue"
  const coloredMatch = lower.match(
    /^highlight\s+(?:the\s+)?(.+?)\s+(?:in|with|using)\s+(yellow|red|green|blue)$/,
  );
  if (coloredMatch?.[1] && coloredMatch[2]) {
    const t = coloredMatch[1].trim();
    if (t) return { kind: "highlight", text: t, color: coloredMatch[2] };
  }

  // Plain highlight: "highlight india"
  const plainMatch = lower.match(/^highlight\s+(?:the\s+)?(.+)$/);
  if (plainMatch?.[1]) {
    const t = plainMatch[1].trim();
    if (t) return { kind: "highlight", text: t, color: "yellow" };
  }

  // 5. A number behind a prefix: "slide 8", "go to slide 8", "page eight".
  //    Ranked below the bare forms and still whole-utterance, so
  //    "please explain slide five" and "this slide has eight points" stay inert.
  const prefixed = NUMBER_PREFIX_PHRASE.exec(lower);
  if (prefixed?.[1]) {
    const n = parseStandaloneNumber(prefixed[1]);
    if (n !== null) return { kind: "slide", n };
  }

  // 6. "the eighth slide", "4th slide". A non-numeric word here falls through
  //    to the title search below, so "go to the introduction slide" still works.
  const ordinalSlide = ORDINAL_SLIDE_PHRASE.exec(lower);
  if (ordinalSlide?.[1]) {
    const n = parseStandaloneNumber(ordinalSlide[1]);
    if (n !== null) return { kind: "slide", n };
  }

  // 7. Extended plan title search: "go to the introduction slide"
  if (allowExtended) {
    const byText = lower.match(/^go to (?:the )?(.+?) slide$/);
    if (byText?.[1]) {
      return { kind: "slideByText", text: byText[1].trim() };
    }
  }

  // Ordinary speech -> DO NOTHING
  return null;
}

/**
 * Test seam: the pure resolver, exported so the command table can be verified
 * without a browser or a microphone. Not used by the hook itself.
 */
export const resolveVoiceCommand = resolveCommand;

/**
 * Identity of a resolved command, used for de-duplication. Keying on the
 * command rather than the transcript means the two spellings Chrome may return
 * for one spoken word ("8" and "ate") collapse to a single navigation.
 */
function commandKey(cmd: ResolvedCommand): string {
  switch (cmd.kind) {
    case "slide":
      return `slide:${cmd.n}`;
    case "highlight":
      return `highlight:${cmd.color}:${cmd.text}`;
    case "removeHighlight":
      return `removeHighlight:${cmd.text}`;
    case "slideByText":
      return `slideByText:${cmd.text}`;
    case "next":
    case "prev":
    case "clearHighlights":
      return cmd.kind;
  }
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
  // the same final result around an auto-restart. Keyed on the resolved
  // command and written only after the command succeeded.
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
      // Keyed on the RESOLVED command, not the raw transcript, so two
      // different transcriptions of one utterance ("8" then "ate") cannot
      // both navigate. Committed only after the command actually succeeds,
      // so an immediate retry of a rejected number is never swallowed.
      const key = commandKey(cmd);
      const now = Date.now();
      if (lastRunRef.current.key === key && now - lastRunRef.current.at < 1000) return false;

      const outcome = ((): boolean | "slide_not_found" => {
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
            return cb.onGoToSlideByText(cmd.text) === false ? "slide_not_found" : true;
        }
      })();

      if (outcome === true) lastRunRef.current = { key, at: now };
      return outcome;
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
    // Final results already executed in the CURRENT recognition session. Some
    // engines replay earlier finals with a reset resultIndex after a restart;
    // this keeps one spoken command to exactly one navigation.
    const handledFinals = new Set<string>();

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

    const scheduleRestart = (delay: number) => {
      // Never leave an orphan timer behind — two pending restarts would race
      // and could deliver the same utterance twice.
      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = window.setTimeout(safeStart, delay);
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
      // A new session numbers its results from zero again.
      handledFinals.clear();
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
          const text: string = result[0]?.transcript ?? "";
          // Skip a final this session already executed (engines that replay
          // earlier results after an internal restart).
          const seenKey = `${i}|${normalise(text)}`;
          if (handledFinals.has(seenKey)) continue;
          handledFinals.add(seenKey);
          if (handledFinals.size > 200) handledFinals.clear();

          const alt: string[] = [];
          for (let a = 1; a < result.length; a++) {
            const t = result[a]?.transcript;
            if (t) alt.push(t);
          }
          finals.push({
            text,
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
      scheduleRestart(1200);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (stoppingRef.current || !enabledRef.current) return;
      // Automatic restart keeps listening continuous across browser timeouts.
      scheduleRestart(300);
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
