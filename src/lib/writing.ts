/**
 * Master Write — the pure logic behind hand-controlled writing.
 *
 * Nothing in this file touches React, the DOM or the camera, so the gesture
 * state machine, the geometry helpers and the eraser can all be exercised
 * without a browser. See scripts/writing-gestures.test.ts.
 */

export type WritingPoint = { x: number; y: number };

/** One continuous fingertip line, stored in slide space (0..1 on both axes). */
export type WritingStroke = {
  id: string;
  color: string;
  points: WritingPoint[];
};

/** The palette is exactly five colours plus the two eraser tools. */
export type WritingTool =
  | "color-0"
  | "color-1"
  | "color-2"
  | "color-3"
  | "color-4"
  | "manual-eraser"
  | "clear-all";

/** "clear-all" runs once when it is picked and is never left armed. */
export type ActiveWritingTool = Exclude<WritingTool, "clear-all">;

/** Red, blue, green, yellow, white — the five writing colours. */
export const WRITING_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#eab308", "#ffffff"] as const;

/** Palette order: the five colours, then Clear All, then the manual eraser. */
export const WRITING_TOOL_ORDER: readonly WritingTool[] = [
  "color-0",
  "color-1",
  "color-2",
  "color-3",
  "color-4",
  "clear-all",
  "manual-eraser",
];

export function toolColor(tool: ActiveWritingTool): string {
  return WRITING_COLORS[Number(tool.slice("color-".length))] ?? WRITING_COLORS[0];
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
 * IDLE          index finger down / no hand — nothing is drawn
 * INDEX_RAISED  finger up, palette offered, still nothing is drawn
 * TOOL_SELECT   fingertip resting on a palette tool
 * WRITING       fingertip movement extends a stroke
 * ERASING       fingertip movement rubs annotations out
 */
export type WriteState = "idle" | "index_raised" | "tool_select" | "writing" | "erasing";

export type WriteSample = {
  /** Fingertip in slide space, or null when the index finger is not raised. */
  point: WritingPoint | null;
  /** True while the fingertip sits inside the open palette. */
  overPalette: boolean;
  /** The palette tool directly under the fingertip, when the palette is open. */
  hit: WritingTool | null;
  /** The tool that is armed right now. */
  tool: ActiveWritingTool;
  now: number;
};

export type WriteEffect =
  | { kind: "select"; tool: ActiveWritingTool }
  | { kind: "clear" }
  | { kind: "begin"; point: WritingPoint }
  | { kind: "extend"; point: WritingPoint }
  | { kind: "erase"; point: WritingPoint }
  | { kind: "end" };

export type WriteFrame = {
  state: WriteState;
  paletteOpen: boolean;
  hovered: WritingTool | null;
  /** Dwell progress on the hovered tool, 0..1. */
  dwell: number;
  cursor: WritingPoint | null;
  effects: WriteEffect[];
};

export const WRITE_TIMINGS = {
  /** Fingertip rest needed to pick a tool. */
  dwellMs: 520,
  /** How long the palette waits to be used before the pen takes over. */
  paletteMs: 900,
  /** Lifting and lowering again inside this window just carries on writing. */
  resumeMs: 900,
  /** A tracking blink shorter than this never breaks a stroke. */
  lostMs: 160,
  /** Ignore fingertip noise below this distance. */
  minStep: 0.002,
  /** Travel needed after picking a tool before ink starts. */
  escapeDist: 0.05,
  /** A jump wider than this starts a new stroke instead of a long straight line. */
  rejoinDist: 0.08,
};

export type WriteTimings = typeof WRITE_TIMINGS;

/**
 * Turns the raised-index-finger stream into palette, writing and erasing
 * decisions. Call `update` once per camera frame; every side effect is returned
 * instead of performed, which keeps the machine testable.
 */
export class WriteGestureMachine {
  private state: WriteState = "idle";
  private paletteOpen = false;
  private paletteDeadline = 0;
  private hovered: WritingTool | null = null;
  private hoverStart = 0;
  private lostAt = 0;
  private strokeOpen = false;
  private lastPoint: WritingPoint | null = null;
  private lastEndAt = 0;
  private escapeFrom: WritingPoint | null = null;
  private now = 0;
  private readonly timings: WriteTimings;

  // A plain field assignment (not a parameter property) so the whole module
  // stays runnable under Node's strip-only type removal — see the test header.
  constructor(timings: WriteTimings = WRITE_TIMINGS) {
    this.timings = timings;
  }

  /** Drops anything in flight — used when the slide changes. */
  reset(): void {
    this.state = "idle";
    this.paletteOpen = false;
    this.paletteDeadline = 0;
    this.hovered = null;
    this.hoverStart = 0;
    this.lostAt = 0;
    this.strokeOpen = false;
    this.lastPoint = null;
    this.lastEndAt = 0;
    this.escapeFrom = null;
  }

  update(sample: WriteSample): WriteFrame {
    const effects: WriteEffect[] = [];
    this.now = sample.now;

    if (!sample.point) return this.handleIndexDown(effects, sample.now);

    this.lostAt = 0;
    if (this.state === "idle") this.handleRaise(sample);
    if (this.paletteOpen) {
      const settled = this.handlePalette(sample, effects);
      if (settled) return settled;
    }
    return this.handleDrawing(sample, effects);
  }

  /** Index finger lowered, neutral, or tracking lost. */
  private handleIndexDown(effects: WriteEffect[], now: number): WriteFrame {
    // A tracking blink must not chop one movement into two strokes.
    if (this.strokeOpen) {
      if (this.lostAt === 0) this.lostAt = now;
      if (now - this.lostAt <= this.timings.lostMs) {
        this.paletteOpen = false;
        return this.frame(effects, null);
      }
      effects.push({ kind: "end" });
      this.strokeOpen = false;
      this.lastEndAt = now;
    } else if (this.state === "writing" || this.state === "erasing") {
      this.lastEndAt = now;
    }

    this.state = "idle";
    this.paletteOpen = false;
    this.hovered = null;
    this.hoverStart = 0;
    this.lastPoint = null;
    this.escapeFrom = null;
    this.lostAt = 0;
    return this.frame(effects, null);
  }

  /** The index finger has just come up out of idle. */
  private handleRaise(sample: WriteSample): void {
    // Lifting the finger for a beat and putting it straight back down carries on
    // writing; a real pause offers the palette again.
    const resuming =
      this.lastEndAt > 0 && sample.now - this.lastEndAt <= this.timings.resumeMs;

    this.paletteOpen = !resuming;
    this.paletteDeadline = sample.now + this.timings.paletteMs;
    this.hovered = null;
    this.hoverStart = 0;
    this.escapeFrom = null;
    this.lastPoint = null;
    this.strokeOpen = false;
    this.state = this.paletteOpen ? "index_raised" : this.drawState(sample.tool);
  }

  /**
   * Runs while the palette is open. Returns a frame when the palette has taken
   * charge of this sample, or null to let the pen have it.
   */
  private handlePalette(sample: WriteSample, effects: WriteEffect[]): WriteFrame | null {
    const point = sample.point;
    if (!point) return null;
    const now = sample.now;

    // Reaching the palette gives the presenter as long as they need.
    if (sample.overPalette) this.paletteDeadline = now + this.timings.paletteMs;

    const hit = sample.hit;
    if (hit) {
      this.state = "tool_select";
      if (this.hovered !== hit) {
        this.hovered = hit;
        this.hoverStart = now;
      }
      // Still resting — report dwell progress and wait.
      if (now - this.hoverStart < this.timings.dwellMs) return this.frame(effects, point);

      if (hit === "clear-all") {
        effects.push({ kind: "clear" });
        this.state = this.drawState(sample.tool);
      } else {
        effects.push({ kind: "select", tool: hit });
        this.state = this.drawState(hit);
      }
      this.paletteOpen = false;
      this.hovered = null;
      this.hoverStart = 0;
      this.lastPoint = null;
      this.strokeOpen = false;
      // Never leave a mark where the palette just was.
      this.escapeFrom = point;
      return this.frame(effects, point);
    }

    this.hovered = null;
    this.hoverStart = 0;
    if (now < this.paletteDeadline) {
      this.state = "index_raised";
      return this.frame(effects, point);
    }

    // Offered and unused — the armed tool takes over.
    this.paletteOpen = false;
    this.lastPoint = null;
    this.state = this.drawState(sample.tool);
    return null;
  }

  /** Ink and eraser movement. */
  private handleDrawing(sample: WriteSample, effects: WriteEffect[]): WriteFrame {
    const point = sample.point;
    if (!point) return this.frame(effects, null);

    // Switching tool mid-stroke (palette or mouse) closes the old line first.
    const wanted = this.drawState(sample.tool);
    if (this.state !== wanted) {
      if (this.strokeOpen) {
        effects.push({ kind: "end" });
        this.strokeOpen = false;
      }
      this.state = wanted;
      this.lastPoint = null;
    }

    // Hold the ink back until the fingertip has left the tool it just picked.
    if (this.escapeFrom) {
      const away = Math.hypot(point.x - this.escapeFrom.x, point.y - this.escapeFrom.y);
      if (away < this.timings.escapeDist) return this.frame(effects, point);
      this.escapeFrom = null;
    }

    if (this.state === "erasing") {
      effects.push({ kind: "erase", point });
      this.lastPoint = point;
      return this.frame(effects, point);
    }

    if (!this.strokeOpen) {
      effects.push({ kind: "begin", point });
      this.strokeOpen = true;
      this.lastPoint = point;
      return this.frame(effects, point);
    }

    const previous = this.lastPoint;
    if (previous) {
      const moved = Math.hypot(point.x - previous.x, point.y - previous.y);
      // A jump this wide is a tracking glitch, not a stroke.
      if (moved > this.timings.rejoinDist) {
        effects.push({ kind: "end" }, { kind: "begin", point });
        this.lastPoint = point;
        return this.frame(effects, point);
      }
      if (moved < this.timings.minStep) return this.frame(effects, point);
    }

    effects.push({ kind: "extend", point });
    this.lastPoint = point;
    return this.frame(effects, point);
  }

  /** The armed tool decides whether movement writes or erases. */
  private drawState(tool: ActiveWritingTool): WriteState {
    return tool === "manual-eraser" ? "erasing" : "writing";
  }

  /** Packages the public snapshot, including live dwell progress. */
  private frame(effects: WriteEffect[], cursor: WritingPoint | null): WriteFrame {
    let dwell = 0;
    if (this.paletteOpen && this.hovered && this.hoverStart > 0) {
      dwell = Math.max(0, Math.min(1, (this.now - this.hoverStart) / this.timings.dwellMs));
    }
    return {
      state: this.state,
      paletteOpen: this.paletteOpen,
      hovered: this.paletteOpen ? this.hovered : null,
      dwell,
      cursor,
      effects,
    };
  }
}

