/**
 * Master Write — the pure logic behind hand-controlled writing.
 *
 * Nothing in this file touches React, the DOM or the camera, so the gesture
 * state machine, the geometry helpers and the eraser can all be exercised
 * without a browser. See scripts/writing-gestures.test.ts.
 *
 * The rule that shapes everything here (§1 §5 §12): RAISING THE INDEX FINGER
 * NEVER WRITES BY ITSELF. A raise opens the toolbar and turns the fingertip
 * into a selector. Only after a tool is picked, and only once the fingertip
 * makes a deliberate movement, does a stroke begin. There is no laser (§13).
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

/** Everything the one toolbar offers: five colours plus the two eraser tools. */
export type WriteMenuItem = WritingColor | "manual-eraser" | "clear-all";

/** Red, blue, green, yellow, white — the five writing colours (§2). */
export const WRITING_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#eab308", "#ffffff"] as const;

/** The colour swatches, in toolbar order. */
export const WRITING_COLOR_ORDER: readonly WritingColor[] = [
  "color-0",
  "color-1",
  "color-2",
  "color-3",
  "color-4",
];

/** The eraser half of the toolbar: Manual Eraser, then Erase All (§9 §10). */
export const ERASER_MENU_ITEMS: readonly WriteMenuItem[] = ["manual-eraser", "clear-all"];

/** Everything on the single writing toolbar, left to right (§2). */
export const WRITE_TOOLBAR_ITEMS: readonly WriteMenuItem[] = [
  ...WRITING_COLOR_ORDER,
  ...ERASER_MENU_ITEMS,
];

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
 * Removes only the parts of the annotations the fingertip passed over (§9).
 * Returns the original array untouched when nothing was hit, so callers can
 * skip a re-render. PPT text, images, shapes and backgrounds are never touched
 * — this only ever sees Master Write's own overlay strokes.
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
 * Gesture state machine (§12)
 * -------------------------------------------------------------------------- */

/**
 * idle          no writing gesture — nothing happens
 * toolbar       finger up, toolbar showing, fingertip is a selector only (§3)
 * ready         a colour is armed, fingertip is a pen cursor — still no ink (§5)
 * writing       a deliberate fingertip movement is drawing a stroke (§6)
 * eraser_ready  Manual Eraser armed, fingertip is an eraser cursor — no erase yet
 * erasing       a deliberate fingertip movement is rubbing marks out (§9)
 */
export type WriteState = "idle" | "toolbar" | "ready" | "writing" | "eraser_ready" | "erasing";

/** Which hand gesture is driving this frame. Both raise the same toolbar. */
export type WriteGesture = "none" | "index" | "eraser";

/** Which tool the fingertip is currently armed with. */
export type WriteTool = "pen" | "eraser";

export type WriteSample = {
  /** index = index finger only, eraser = index + middle, none = neither. */
  gesture: WriteGesture;
  /** The INDEX FINGERTIP in slide space (landmark 8), or null when absent (§7). */
  point: WritingPoint | null;
  /** The toolbar item directly under the fingertip, while the toolbar is open. */
  hit: WriteMenuItem | null;
  now: number;
};

export type WriteEffect =
  | { kind: "select-color"; color: WritingColor }
  | { kind: "select-eraser" }
  | { kind: "clear" }
  | { kind: "begin"; point: WritingPoint }
  | { kind: "extend"; point: WritingPoint }
  | { kind: "erase"; point: WritingPoint }
  | { kind: "end" };

/**
 * How the fingertip cursor should look. The `-active` variants mean a stroke or
 * an erase is happening right now, so the presenter can see the difference
 * between pointing and writing (§3 §5).
 */
export type CursorMode = "select" | "pen" | "pen-active" | "eraser" | "eraser-active" | null;

export type WriteFrame = {
  state: WriteState;
  /** True while the single writing toolbar is on screen (§2 §11). */
  toolbarOpen: boolean;
  hovered: WriteMenuItem | null;
  /** Dwell progress on the hovered item, 0..1. */
  dwell: number;
  cursor: WritingPoint | null;
  cursorMode: CursorMode;
  /** The armed tool, so the toolbar can show which one is live. */
  tool: WriteTool;
  effects: WriteEffect[];
};

export const WRITE_TIMINGS = {
  /** Fingertip rest needed to pick a toolbar item. */
  dwellMs: 480,
  /** Lowering the finger and raising it inside this window keeps the armed tool. */
  resumeMs: 1500,
  /** A tracking blink shorter than this never breaks a stroke (§6). */
  lostMs: 160,
  /**
   * After a pick the fingertip has to travel to wherever the presenter wants to
   * work, and that travel must not leave a mark (§4). So the tool only arms once
   * the fingertip has held inside `settleDist` for `settleMs` — which is what
   * arriving somewhere looks like. Short enough to feel immediate.
   */
  settleMs: 140,
  settleDist: 0.01,
  /**
   * The deliberate-writing threshold (§5): the fingertip must travel this far
   * inside `activateMs` for a stroke to start. Small enough to feel immediate,
   * big enough that a parked finger is a cursor and nothing else.
   */
  activateDist: 0.012,
  activateMs: 220,
  /** Holding still this long lifts the pen again, without lowering the finger. */
  idleEndMs: 400,
  /** Once a stroke is open, ink follows the fingertip down to this step (§6 §8). */
  minStep: 0.0015,
  /** A jump wider than this is a tracking glitch, not a stroke. */
  rejoinDist: 0.09,
  /** Frames an index<->index+middle switch must hold before it counts (§12). */
  gestureHoldFrames: 3,
};

export type WriteTimings = typeof WRITE_TIMINGS;

/** Straight-line distance between two slide-space points. */
function gap(a: WritingPoint, b: WritingPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Turns the index-fingertip stream into toolbar, writing and erasing decisions.
 * Call `update` once per camera frame; every side effect is returned rather than
 * performed, which keeps the machine testable and the render loop imperative.
 */
export class WriteGestureMachine {
  private state: WriteState = "idle";
  private tool: WriteTool = "pen";
  private toolbarOpen = false;
  private hovered: WriteMenuItem | null = null;
  private hoverStart = 0;
  private lostAt = 0;
  private strokeOpen = false;
  private lastPoint: WritingPoint | null = null;
  private lastActiveEndAt = 0;
  /** False until the fingertip has settled after a pick — no ink before that. */
  private armed = false;
  private settleFrom: WritingPoint | null = null;
  private settleAt = 0;
  /** Where the current movement window started, and when. */
  private anchor: WritingPoint | null = null;
  private anchorAt = 0;
  private moveFrom: WritingPoint | null = null;
  private lastMoveAt = 0;
  private now = 0;
  /** Debounced gesture, so one misread frame never switches tools (§12). */
  private heldGesture: WriteGesture = "none";
  private pendingGesture: WriteGesture = "none";
  private pendingCount = 0;
  /** Last frame's settled gesture, used to spot the raise of a second finger. */
  private frameGesture: WriteGesture = "none";
  private readonly timings: WriteTimings;

  // A plain field assignment (not a parameter property) so the whole module
  // stays runnable under Node's strip-only type removal — see the test header.
  constructor(timings: WriteTimings = WRITE_TIMINGS) {
    this.timings = timings;
  }

  /** Drops anything in flight — used when the slide changes (§14). */
  reset(): void {
    this.state = "idle";
    this.tool = "pen";
    this.toolbarOpen = false;
    this.hovered = null;
    this.hoverStart = 0;
    this.lostAt = 0;
    this.strokeOpen = false;
    this.lastPoint = null;
    this.lastActiveEndAt = 0;
    this.armed = false;
    this.settleFrom = null;
    this.settleAt = 0;
    this.anchor = null;
    this.anchorAt = 0;
    this.moveFrom = null;
    this.lastMoveAt = 0;
    this.heldGesture = "none";
    this.pendingGesture = "none";
    this.pendingCount = 0;
    this.frameGesture = "none";
  }

  update(sample: WriteSample): WriteFrame {
    const effects: WriteEffect[] = [];
    this.now = sample.now;
    const gesture = this.stableGesture(sample.gesture);
    const previous = this.frameGesture;
    this.frameGesture = gesture;

    if (gesture === "none" || !sample.point) {
      return this.handleRelease(effects, sample.now);
    }
    this.lostAt = 0;

    // Raising the middle finger brings the toolbar back, so the presenter can
    // swap tool or reach Erase All without lowering their hand (§12 §16). Only
    // on the raise — holding two fingers up would otherwise re-open the toolbar
    // the instant something was picked from it (§11).
    if (gesture === "eraser" && previous !== "eraser") {
      this.openToolbar(effects, sample.now);
    } else if (this.state === "idle") {
      this.enterActive(sample.now);
    }

    if (this.toolbarOpen) return this.handleToolbar(sample, effects, sample.point);
    if (this.state === "eraser_ready" || this.state === "erasing") {
      return this.handleErase(effects, sample.point, sample.now);
    }
    return this.handleWrite(effects, sample.point, sample.now);
  }

  /**
   * Index and index+middle look alike for a frame or two when a finger is on the
   * way up, so a real gesture change has to hold before it counts. Losing the
   * hand, and getting it back, are honoured at once — `lostMs` covers those.
   */
  private stableGesture(gesture: WriteGesture): WriteGesture {
    const held = this.heldGesture;
    if (gesture === held) {
      this.pendingGesture = gesture;
      this.pendingCount = 0;
      return gesture;
    }
    if (gesture === "none" || held === "none") {
      this.heldGesture = gesture;
      this.pendingGesture = gesture;
      this.pendingCount = 0;
      return gesture;
    }
    if (gesture !== this.pendingGesture) {
      this.pendingGesture = gesture;
      this.pendingCount = 1;
    } else {
      this.pendingCount += 1;
    }
    if (this.pendingCount < this.timings.gestureHoldFrames) return held;
    this.heldGesture = gesture;
    this.pendingCount = 0;
    return gesture;
  }

  /** No writing gesture: hand down, fist, palm, or tracking lost. */
  private handleRelease(effects: WriteEffect[], now: number): WriteFrame {
    if (this.state !== "idle") {
      // A tracking blink must not chop one movement into two strokes (§6).
      if (this.lostAt === 0) this.lostAt = now;
      if (now - this.lostAt <= this.timings.lostMs) return this.frame(effects, null);
      if (this.strokeOpen) {
        effects.push({ kind: "end" });
        this.strokeOpen = false;
      }
      // Only an armed tool is worth resuming; a toolbar left open is not.
      if (this.state !== "toolbar") this.lastActiveEndAt = now;
    }

    this.state = "idle";
    this.toolbarOpen = false;
    this.hovered = null;
    this.hoverStart = 0;
    this.lastPoint = null;
    this.anchor = null;
    this.moveFrom = null;
    this.lastMoveAt = 0;
    this.lostAt = 0;
    this.armed = false;
    this.settleFrom = null;
    this.settleAt = 0;
    return this.frame(effects, null);
  }

  /**
   * A fresh raise. The toolbar opens and the fingertip is a selector — it never
   * starts writing on its own (§1 §5). Lowering the finger for a beat and
   * raising it again keeps the armed tool instead, so writing is not interrupted.
   */
  private enterActive(now: number): void {
    const resuming =
      this.lastActiveEndAt > 0 && now - this.lastActiveEndAt <= this.timings.resumeMs;
    this.toolbarOpen = !resuming;
    this.hovered = null;
    this.hoverStart = 0;
    this.strokeOpen = false;
    this.lastPoint = null;
    this.anchor = null;
    this.moveFrom = null;
    this.lastMoveAt = 0;
    // Coming back mid-writing still has to settle, so a re-raise on the move
    // never flicks a stray line across the slide (§4 §6).
    this.armed = false;
    this.settleFrom = null;
    this.settleAt = 0;
    if (!resuming) this.state = "toolbar";
    else this.state = this.tool === "eraser" ? "eraser_ready" : "ready";
  }

  /** Brings the toolbar back, closing any stroke that was in progress first. */
  private openToolbar(effects: WriteEffect[], now: number): void {
    if (this.strokeOpen) {
      effects.push({ kind: "end" });
      this.strokeOpen = false;
      this.lastActiveEndAt = now;
    }
    this.toolbarOpen = true;
    this.state = "toolbar";
    this.hovered = null;
    this.hoverStart = 0;
    this.lastPoint = null;
    this.anchor = null;
    this.moveFrom = null;
    this.lastMoveAt = 0;
    this.armed = false;
    this.settleFrom = null;
    this.settleAt = 0;
  }

  /**
   * The toolbar owns the fingertip while it is open: the presenter selects, and
   * nothing is ever drawn (§3 §4). It never times out into writing — the only
   * ways out are picking something or lowering the finger.
   */
  private handleToolbar(
    sample: WriteSample,
    effects: WriteEffect[],
    point: WritingPoint,
  ): WriteFrame {
    const now = sample.now;
    const hit = sample.hit;
    if (!hit) {
      this.hovered = null;
      this.hoverStart = 0;
      return this.frame(effects, point, "select");
    }

    if (this.hovered !== hit) {
      this.hovered = hit;
      this.hoverStart = now;
    }
    if (now - this.hoverStart < this.timings.dwellMs) {
      return this.frame(effects, point, "select");
    }

    // Picked. The toolbar gets out of the way (§11) and the fingertip becomes the
    // armed tool — a cursor only, until it has settled and then moved (§4 §5).
    this.hovered = null;
    this.hoverStart = 0;
    this.toolbarOpen = false;
    this.lastPoint = null;
    this.anchor = null;
    this.anchorAt = now;
    this.moveFrom = null;
    this.lastMoveAt = 0;
    this.armed = false;
    this.settleFrom = point;
    this.settleAt = now;
    return this.applyPick(hit, effects, point);
  }

  /** Turns a completed dwell into the armed tool. */
  private applyPick(hit: WriteMenuItem, effects: WriteEffect[], point: WritingPoint): WriteFrame {
    if (hit === "clear-all") {
      // Erase All wipes the slide, then hands back the normal pen cursor (§10).
      effects.push({ kind: "clear" });
      this.tool = "pen";
      this.state = "ready";
      return this.frame(effects, point, "pen");
    }
    if (hit === "manual-eraser") {
      effects.push({ kind: "select-eraser" });
      this.tool = "eraser";
      this.state = "eraser_ready";
      return this.frame(effects, point, "eraser");
    }
    effects.push({ kind: "select-color", color: hit });
    this.tool = "pen";
    this.state = "ready";
    return this.frame(effects, point, "pen");
  }

  /**
   * The gate between picking a tool and being allowed to mark the slide (§4).
   * The fingertip has to hold inside `settleDist` for `settleMs` — the shape of
   * arriving somewhere — so the trip from the toolbar to the writing spot, or a
   * re-raise while the hand is moving, can never draw.
   */
  private settled(point: WritingPoint, now: number): boolean {
    if (this.armed) return true;
    const from = this.settleFrom;
    if (!from || gap(point, from) > this.timings.settleDist) {
      this.settleFrom = point;
      this.settleAt = now;
      return false;
    }
    if (now - this.settleAt < this.timings.settleMs) return false;
    this.armed = true;
    this.settleFrom = null;
    this.anchor = point;
    this.anchorAt = now;
    return true;
  }

  /**
   * The deliberate-action test (§5). True the moment the fingertip has travelled
   * `activateDist` from where the current window started; the window slides
   * forward when it expires, so a slowly drifting hand never trips it.
   */
  private moved(point: WritingPoint, now: number): boolean {
    this.moveFrom = null;
    const anchor = this.anchor;
    if (!anchor) {
      this.anchor = point;
      this.anchorAt = now;
      return false;
    }
    if (gap(point, anchor) >= this.timings.activateDist) {
      this.moveFrom = anchor;
      this.anchor = point;
      this.anchorAt = now;
      this.lastMoveAt = now;
      return true;
    }
    if (now - this.anchorAt > this.timings.activateMs) {
      this.anchor = point;
      this.anchorAt = now;
    }
    return false;
  }

  /**
   * Pen cursor and ink (§5 §6). A parked fingertip is only a cursor; the first
   * deliberate movement opens a stroke at the point the movement started, so
   * nothing is clipped off the front of a letter. From then on ink follows the
   * fingertip every frame it clears `minStep`, which is what makes it real time.
   */
  private handleWrite(effects: WriteEffect[], point: WritingPoint, now: number): WriteFrame {
    if (!this.settled(point, now)) return this.frame(effects, point, "pen");
    const moving = this.moved(point, now);

    if (!this.strokeOpen) {
      if (!moving) {
        this.state = "ready";
        return this.frame(effects, point, "pen");
      }
      const from = this.moveFrom ?? point;
      effects.push({ kind: "begin", point: from }, { kind: "extend", point });
      this.strokeOpen = true;
      this.lastPoint = point;
      this.state = "writing";
      return this.frame(effects, point, "pen-active");
    }

    // Holding still lifts the pen — the finger can stay up between strokes.
    if (!moving && now - this.lastMoveAt > this.timings.idleEndMs) {
      effects.push({ kind: "end" });
      this.strokeOpen = false;
      this.lastPoint = null;
      this.state = "ready";
      return this.frame(effects, point, "pen");
    }

    const previous = this.lastPoint;
    if (previous) {
      const step = gap(point, previous);
      if (step > this.timings.rejoinDist) {
        effects.push({ kind: "end" }, { kind: "begin", point });
        this.lastPoint = point;
        return this.frame(effects, point, "pen-active");
      }
      if (step < this.timings.minStep) return this.frame(effects, point, "pen-active");
    }
    effects.push({ kind: "extend", point });
    this.lastPoint = point;
    return this.frame(effects, point, "pen-active");
  }

  /**
   * Manual Eraser (§9). Same deliberate-movement rule as the pen, so resting the
   * armed eraser over a mark never wipes it — the presenter has to sweep.
   */
  private handleErase(effects: WriteEffect[], point: WritingPoint, now: number): WriteFrame {
    if (!this.settled(point, now)) return this.frame(effects, point, "eraser");
    const moving = this.moved(point, now);

    if (this.state !== "erasing") {
      if (!moving) return this.frame(effects, point, "eraser");
      this.state = "erasing";
      this.lastPoint = point;
      effects.push({ kind: "erase", point });
      return this.frame(effects, point, "eraser-active");
    }

    if (!moving && now - this.lastMoveAt > this.timings.idleEndMs) {
      this.state = "eraser_ready";
      this.lastPoint = null;
      return this.frame(effects, point, "eraser");
    }

    const previous = this.lastPoint;
    if (previous && gap(point, previous) < this.timings.minStep) {
      return this.frame(effects, point, "eraser-active");
    }
    effects.push({ kind: "erase", point });
    this.lastPoint = point;
    return this.frame(effects, point, "eraser-active");
  }

  /** Packages the public snapshot, including live dwell progress. */
  private frame(
    effects: WriteEffect[],
    cursor: WritingPoint | null,
    cursorMode: CursorMode = null,
  ): WriteFrame {
    let dwell = 0;
    if (this.toolbarOpen && this.hovered && this.hoverStart > 0) {
      dwell = Math.max(0, Math.min(1, (this.now - this.hoverStart) / this.timings.dwellMs));
    }
    return {
      state: this.state,
      toolbarOpen: this.toolbarOpen,
      hovered: this.toolbarOpen ? this.hovered : null,
      dwell,
      cursor,
      cursorMode: cursor ? cursorMode : null,
      tool: this.tool,
      effects,
    };
  }
}
