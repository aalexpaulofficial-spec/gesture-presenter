/**
 * Master Write — the pure logic behind hand-controlled writing.
 *
 * Nothing in this file touches React, the DOM or the camera, so the gesture
 * state machine, the geometry helpers and the eraser can all be exercised
 * without a browser. See scripts/writing-gestures.test.ts.
 *
 * Gesture split (§2 §6 §10):
 *   • index finger only      → colour palette, then writing
 *   • index + middle finger  → eraser controls (Manual Eraser / Erase All)
 * There is no laser here, ever (§12).
 */

export type WritingPoint = { x: number; y: number };

/** One continuous fingertip line, stored in slide space (0..1 on both axes). */
export type WritingStroke = {
  id: string;
  color: string;
  points: WritingPoint[];
};

/** The five writing colours. */
export type WritingColor = "color-0" | "color-1" | "color-2" | "color-3" | "color-4";

/** Everything the two menus can offer: the five colours plus the two eraser tools. */
export type WriteMenuItem = WritingColor | "manual-eraser" | "clear-all";

/** Red, blue, green, yellow, white — the five writing colours (§2). */
export const WRITING_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#eab308", "#ffffff"] as const;

/** The colour palette shown for the index-only gesture. */
export const WRITING_COLOR_ORDER: readonly WritingColor[] = [
  "color-0",
  "color-1",
  "color-2",
  "color-3",
  "color-4",
];

/** The eraser controls shown for the index + middle gesture: Manual Eraser, then Erase All. */
export const ERASER_MENU_ITEMS: readonly WriteMenuItem[] = ["manual-eraser", "clear-all"];

export function colorValue(color: WritingColor): string {
  return WRITING_COLORS[Number(color.slice("color-".length))] ?? WRITING_COLORS[0];
}

/** How far the manual eraser reaches, in slide-space units. */
export const ERASER_RADIUS = 0.035;

/** Shortest distance from `point` to the segment a-b. */
export function distanceToSegment(point: WritingPoint, a: WritingPoint, b: WritingPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** True when any part of the stroke falls inside the eraser disc. */
export function strokeNearPoint(
  stroke: WritingStroke,
  point: WritingPoint,
  radius: number,
): boolean {
  const first = stroke.points[0];
  if (!first) return false;
  if (stroke.points.length === 1) {
    return Math.hypot(first.x - point.x, first.y - point.y) <= radius;
  }
  for (let i = 1; i < stroke.points.length; i += 1) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    if (a && b && distanceToSegment(point, a, b) <= radius) return true;
  }
  return false;
}

/**
 * Cuts the eraser disc out of one stroke and returns whatever survives, so the
 * presenter can rub out the middle of a line and keep both ends.
 */
function splitStrokeAroundPoint(
  stroke: WritingStroke,
  point: WritingPoint,
  radius: number,
  makeId: () => string,
): WritingStroke[] {
  const pieces: WritingStroke[] = [];
  let run: WritingPoint[] = [];
  const flush = () => {
    if (run.length >= 2) pieces.push({ id: makeId(), color: stroke.color, points: run });
    run = [];
  };

  let previous: WritingPoint | null = null;
  for (const current of stroke.points) {
    if (Math.hypot(current.x - point.x, current.y - point.y) <= radius) {
      flush();
      previous = null;
      continue;
    }
    // Both ends survived but the line between them ran through the eraser.
    if (previous && distanceToSegment(point, previous, current) <= radius) flush();
    run.push(current);
    previous = current;
  }
  flush();
  return pieces;
}

/**
 * Removes only the parts of the annotations the fingertip passed over. Returns
 * the original array untouched when nothing was hit, so callers can skip a
 * re-render.
 */
export function eraseFromStrokes(
  strokes: WritingStroke[],
  point: WritingPoint,
  radius: number,
  makeId: () => string,
): WritingStroke[] {
  let erased = false;
  const next: WritingStroke[] = [];
  for (const stroke of strokes) {
    if (!strokeNearPoint(stroke, point, radius)) {
      next.push(stroke);
      continue;
    }
    erased = true;
    for (const piece of splitStrokeAroundPoint(stroke, point, radius, makeId)) next.push(piece);
  }
  return erased ? next : strokes;
}

/* -------------------------------------------------------------------------- *
 * Gesture state machine
 * -------------------------------------------------------------------------- */

/**
 * idle         no writing/eraser gesture — nothing happens
 * color_menu   index up, colour palette offered, nothing drawn yet (§2)
 * writing      index moving — a stroke is being drawn (§4)
 * eraser_menu  index + middle up, eraser controls offered (§6)
 * erasing      manual eraser active — fingertip rubs marks out (§7)
 * eraser_idle  Erase All has run; index + middle still up but idle (§8)
 */
export type WriteState =
  | "idle"
  | "color_menu"
  | "writing"
  | "eraser_menu"
  | "erasing"
  | "eraser_idle";

/** Which hand gesture is driving this frame. */
export type WriteGesture = "none" | "index" | "eraser";

export type WriteSample = {
  /** The gesture the hand is making: index only, index + middle, or neither. */
  gesture: WriteGesture;
  /** Index fingertip in slide space, or null when neither gesture is active. */
  point: WritingPoint | null;
  /** True while the fingertip sits inside the open menu. */
  overMenu: boolean;
  /** The menu item directly under the fingertip, when a menu is open. */
  hit: WriteMenuItem | null;
  now: number;
};

export type WriteEffect =
  | { kind: "select-color"; color: WritingColor }
  | { kind: "clear" }
  | { kind: "begin"; point: WritingPoint }
  | { kind: "extend"; point: WritingPoint }
  | { kind: "erase"; point: WritingPoint }
  | { kind: "end" };

/** How the fingertip cursor should look for the current mode. */
export type CursorMode = "pen" | "eraser" | "select" | null;

export type WriteFrame = {
  state: WriteState;
  colorMenuOpen: boolean;
  eraserMenuOpen: boolean;
  hovered: WriteMenuItem | null;
  /** Dwell progress on the hovered item, 0..1. */
  dwell: number;
  cursor: WritingPoint | null;
  cursorMode: CursorMode;
  effects: WriteEffect[];
};

export const WRITE_TIMINGS = {
  /** Fingertip rest needed to pick a menu item. */
  dwellMs: 520,
  /** How long the colour palette waits to be used before the pen takes over. */
  paletteMs: 900,
  /** Lowering and raising again inside this window just carries on. */
  resumeMs: 900,
  /** A tracking blink shorter than this never breaks a stroke. */
  lostMs: 160,
  /** Ignore fingertip noise below this distance. */
  minStep: 0.002,
  /** Travel needed after picking a tool before ink or erasing starts. */
  escapeDist: 0.05,
  /** A jump wider than this starts a new stroke instead of a long straight line. */
  rejoinDist: 0.08,
};

export type WriteTimings = typeof WRITE_TIMINGS;

/**
 * Turns the index / index+middle fingertip stream into palette, writing and
 * erasing decisions. Call `update` once per camera frame; every side effect is
 * returned instead of performed, which keeps the machine testable.
 */
export class WriteGestureMachine {
  private state: WriteState = "idle";
  private colorMenuOpen = false;
  private eraserMenuOpen = false;
  private menuDeadline = 0;
  private hovered: WriteMenuItem | null = null;
  private hoverStart = 0;
  private lostAt = 0;
  private strokeOpen = false;
  private lastPoint: WritingPoint | null = null;
  private lastWriteEndAt = 0;
  private lastEraseEndAt = 0;
  private escapeFrom: WritingPoint | null = null;
  private now = 0;
  private readonly timings: WriteTimings;

  // A plain field assignment (not a parameter property) so the whole module
  // stays runnable under Node's strip-only type removal — see the test header.
  constructor(timings: WriteTimings = WRITE_TIMINGS) {
    this.timings = timings;
  }

  /** Drops anything in flight — used when the slide changes (§17). */
  reset(): void {
    this.state = "idle";
    this.colorMenuOpen = false;
    this.eraserMenuOpen = false;
    this.menuDeadline = 0;
    this.hovered = null;
    this.hoverStart = 0;
    this.lostAt = 0;
    this.strokeOpen = false;
    this.lastPoint = null;
    this.lastWriteEndAt = 0;
    this.lastEraseEndAt = 0;
    this.escapeFrom = null;
  }

    update(sample: WriteSample): WriteFrame {
    const effects: WriteEffect[] = [];
    this.now = sample.now;

    if (sample.gesture === "none" || !sample.point) {
      return this.handleRelease(effects, sample.now);
    }

    this.lostAt = 0;
    if (sample.gesture === "eraser") return this.handleEraser(sample, effects);
    return this.handleIndex(sample, effects);
  }

  /** Neither gesture is active (hand down, fist, palm, or tracking lost). */
  private handleRelease(effects: WriteEffect[], now: number): WriteFrame {
    // A tracking blink must not chop one movement into two strokes (§5).
    if (this.strokeOpen) {
      if (this.lostAt === 0) this.lostAt = now;
      if (now - this.lostAt <= this.timings.lostMs) return this.frame(effects, null);
      effects.push({ kind: "end" });
      this.strokeOpen = false;
      this.lastWriteEndAt = now;
    } else if (this.state === "writing") {
      this.lastWriteEndAt = now;
    } else if (this.state === "erasing") {
      if (this.lostAt === 0) this.lostAt = now;
      if (now - this.lostAt <= this.timings.lostMs) return this.frame(effects, null);
      this.lastEraseEndAt = now;
    }

    this.state = "idle";
    this.colorMenuOpen = false;
    this.eraserMenuOpen = false;
    this.hovered = null;
    this.hoverStart = 0;
    this.lastPoint = null;
    this.escapeFrom = null;
    this.lostAt = 0;
    return this.frame(effects, null);
  }

    /* ----- index-only: colour palette then writing ------------------------- */

  private handleIndex(sample: WriteSample, effects: WriteEffect[]): WriteFrame {
    const point = sample.point;
    if (!point) return this.frame(effects, null);

    if (this.state !== "color_menu" && this.state !== "writing") this.enterIndex(sample);

    if (this.colorMenuOpen) {
      const settled = this.handleColorMenu(sample, effects, point);
      if (settled) return settled;
    }
    return this.handleWrite(effects, point);
  }

  private enterIndex(sample: WriteSample): void {
    // Lowering the finger for a beat and raising it carries on writing; a real
    // pause offers the palette again (§5 §15).
    const resuming =
      this.lastWriteEndAt > 0 && sample.now - this.lastWriteEndAt <= this.timings.resumeMs;
    this.colorMenuOpen = !resuming;
    this.eraserMenuOpen = false;
    this.menuDeadline = sample.now + this.timings.paletteMs;
    this.hovered = null;
    this.hoverStart = 0;
    this.escapeFrom = null;
    this.lastPoint = null;
    this.strokeOpen = false;
    this.state = this.colorMenuOpen ? "color_menu" : "writing";
  }

    /** Colour palette. Returns a frame once it owns the sample, or null for the pen. */
  private handleColorMenu(
    sample: WriteSample,
    effects: WriteEffect[],
    point: WritingPoint,
  ): WriteFrame | null {
    const now = sample.now;
    // Reaching the palette gives the presenter as long as they need.
    if (sample.overMenu) this.menuDeadline = now + this.timings.paletteMs;

    const hit = sample.hit;
    if (hit && isColor(hit)) {
      if (this.hovered !== hit) {
        this.hovered = hit;
        this.hoverStart = now;
      }
      if (now - this.hoverStart < this.timings.dwellMs) return this.frame(effects, point, "select");

      effects.push({ kind: "select-color", color: hit });
      this.colorMenuOpen = false;
      this.hovered = null;
      this.hoverStart = 0;
      this.lastPoint = null;
      this.strokeOpen = false;
      this.escapeFrom = point; // never leave a mark where the palette just was
      this.state = "writing";
      return this.frame(effects, point, "pen");
    }

    this.hovered = null;
    this.hoverStart = 0;
    if (now < this.menuDeadline) {
      this.state = "color_menu";
      return this.frame(effects, point, "select");
    }
    // Offered and unused — the pen takes over with the armed colour (§4).
    this.colorMenuOpen = false;
    this.lastPoint = null;
    this.state = "writing";
    return null;
  }

    /** Ink movement (§4 §18). */
  private handleWrite(effects: WriteEffect[], point: WritingPoint): WriteFrame {
    // Hold the ink back until the fingertip has left the tool it just picked.
    if (this.escapeFrom) {
      const away = Math.hypot(point.x - this.escapeFrom.x, point.y - this.escapeFrom.y);
      if (away < this.timings.escapeDist) return this.frame(effects, point, "pen");
      this.escapeFrom = null;
    }

    if (!this.strokeOpen) {
      effects.push({ kind: "begin", point });
      this.strokeOpen = true;
      this.lastPoint = point;
      return this.frame(effects, point, "pen");
    }

    const previous = this.lastPoint;
    if (previous) {
      const moved = Math.hypot(point.x - previous.x, point.y - previous.y);
      // A jump this wide is a tracking glitch, not a stroke.
      if (moved > this.timings.rejoinDist) {
        effects.push({ kind: "end" }, { kind: "begin", point });
        this.lastPoint = point;
        return this.frame(effects, point, "pen");
      }
      if (moved < this.timings.minStep) return this.frame(effects, point, "pen");
    }

    effects.push({ kind: "extend", point });
    this.lastPoint = point;
    return this.frame(effects, point, "pen");
  }

    /* ----- index + middle: eraser controls then erasing -------------------- */

  private handleEraser(sample: WriteSample, effects: WriteEffect[]): WriteFrame {
    const point = sample.point;
    if (!point) return this.frame(effects, null);

    if (this.state !== "eraser_menu" && this.state !== "erasing" && this.state !== "eraser_idle") {
      this.enterEraser(sample, effects);
    }

    if (this.eraserMenuOpen) {
      const settled = this.handleEraserMenu(sample, effects, point);
      if (settled) return settled;
    }

    if (this.state === "erasing") {
      if (this.escapeFrom) {
        const away = Math.hypot(point.x - this.escapeFrom.x, point.y - this.escapeFrom.y);
        if (away < this.timings.escapeDist) return this.frame(effects, point, "eraser");
        this.escapeFrom = null;
      }
      effects.push({ kind: "erase", point });
      this.lastPoint = point;
      return this.frame(effects, point, "eraser");
    }

    // eraser_idle after Erase All — do nothing until the fingers drop (§8).
    return this.frame(effects, point, null);
  }

    private enterEraser(sample: WriteSample, effects: WriteEffect[]): void {
    // Switching gesture mid-stroke closes the open line first.
    if (this.strokeOpen) {
      effects.push({ kind: "end" });
      this.strokeOpen = false;
      this.lastWriteEndAt = sample.now;
    } else if (this.state === "writing") {
      this.lastWriteEndAt = sample.now;
    }
    // Lifting the fingers briefly and raising them again keeps erasing (§5).
    const resuming =
      this.lastEraseEndAt > 0 && sample.now - this.lastEraseEndAt <= this.timings.resumeMs;
    this.eraserMenuOpen = !resuming;
    this.colorMenuOpen = false;
    this.hovered = null;
    this.hoverStart = 0;
    this.lastPoint = null;
    this.escapeFrom = null;
    this.state = resuming ? "erasing" : "eraser_menu";
  }

    /** Eraser controls. Returns a frame once it owns the sample (never auto-erases). */
  private handleEraserMenu(
    sample: WriteSample,
    effects: WriteEffect[],
    point: WritingPoint,
  ): WriteFrame | null {
    const now = sample.now;
    const hit = sample.hit;
    if (hit === "manual-eraser" || hit === "clear-all") {
      if (this.hovered !== hit) {
        this.hovered = hit;
        this.hoverStart = now;
      }
      if (now - this.hoverStart < this.timings.dwellMs) return this.frame(effects, point, "select");

      if (hit === "clear-all") {
        effects.push({ kind: "clear" });
        this.eraserMenuOpen = false;
        this.hovered = null;
        this.hoverStart = 0;
        this.lastPoint = null;
        this.state = "eraser_idle";
        return this.frame(effects, point, null);
      }
      // Manual eraser armed — start erasing, but not where the menu just was.
      this.eraserMenuOpen = false;
      this.hovered = null;
      this.hoverStart = 0;
      this.lastPoint = null;
      this.escapeFrom = point;
      this.state = "erasing";
      return this.frame(effects, point, "eraser");
    }

    // Resting on nothing — keep the controls up and safe (never auto-erase).
    this.hovered = null;
    this.hoverStart = 0;
    this.state = "eraser_menu";
    return this.frame(effects, point, "select");
  }

    /** Packages the public snapshot, including live dwell progress. */
  private frame(
    effects: WriteEffect[],
    cursor: WritingPoint | null,
    cursorMode: CursorMode = null,
  ): WriteFrame {
    const menuOpen = this.colorMenuOpen || this.eraserMenuOpen;
    let dwell = 0;
    if (menuOpen && this.hovered && this.hoverStart > 0) {
      dwell = Math.max(0, Math.min(1, (this.now - this.hoverStart) / this.timings.dwellMs));
    }
    return {
      state: this.state,
      colorMenuOpen: this.colorMenuOpen,
      eraserMenuOpen: this.eraserMenuOpen,
      hovered: menuOpen ? this.hovered : null,
      dwell,
      cursor,
      cursorMode: cursor ? cursorMode : null,
      effects,
    };
  }
}

/** The five colours are the only items that live in the colour palette. */
function isColor(item: WriteMenuItem): item is WritingColor {
  return item !== "manual-eraser" && item !== "clear-all";
}
