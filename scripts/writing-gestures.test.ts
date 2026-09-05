/**
 * Master Write — gesture + geometry test (one index finger, one toolbar).
 *
 * Dependency-free: run with Node 24+, which strips the type annotations from the
 * imported module directly. src/lib/writing.ts pulls in no React, DOM or camera
 * code, so the whole surface can be exercised in a plain process.
 *
 *   node scripts/writing-gestures.test.ts
 *
 * The rule under test above all others (§1 §5): raising the index finger opens
 * the toolbar and moves a cursor. It never writes by itself.
 */

import {
  ERASER_MENU_ITEMS,
  WRITE_TIMINGS,
  WRITE_TOOLBAR_ITEMS,
  WRITING_COLORS,
  WRITING_COLOR_ORDER,
  WriteGestureMachine,
  colorValue,
  distanceToSegment,
  eraseFromStrokes,
  strokeNearPoint,
  type WriteEffect,
  type WriteFrame,
  type WriteGesture,
  type WriteMenuItem,
  type WriteSample,
  type WritingPoint,
  type WritingStroke,
} from "../src/lib/writing.ts";

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) passed += 1;
  else failures.push(`  ${msg}`);
}

function group(title: string, fn: () => void): void {
  const before = failures.length;
  fn();
  const failed = failures.length - before;
  const label = failed === 0 ? "PASS" : `FAIL (${failed})`;
  console.log(`${label.padEnd(10)} ${title}`);
}
/** The effect kinds of one frame, in order, for easy comparison. */
function kinds(effects: WriteEffect[]): string {
  return effects.map((e) => e.kind).join(",");
}

/** Fills in the boring parts of a sample; `gesture` defaults to the index finger. */
function sample(over: Partial<WriteSample> & { now: number }): WriteSample {
  return {
    gesture: over.gesture ?? "index",
    point: over.point ?? null,
    hit: over.hit ?? null,
    now: over.now,
  };
}

function step(m: WriteGestureMachine, over: Partial<WriteSample> & { now: number }): WriteFrame {
  return m.update(sample(over));
}

const T = WRITE_TIMINGS;
/** A spot on the toolbar, and a spot out in the middle of the slide. */
const TOOL: WritingPoint = { x: 0.5, y: 0.9 };
const MID: WritingPoint = { x: 0.5, y: 0.5 };

/** Raises the finger and dwells on `item`; returns the frame that picks it. */
function pick(
  m: WriteGestureMachine,
  item: WriteMenuItem,
  startNow: number,
  gesture: WriteGesture = "index",
): WriteFrame {
  step(m, { gesture, point: TOOL, now: startNow });
  step(m, { gesture, point: TOOL, hit: item, now: startNow + 10 });
  return step(m, { gesture, point: TOOL, hit: item, now: startNow + 10 + T.dwellMs });
}

/**
 * Carries the fingertip from the toolbar out to `at` and holds it there until the
 * armed tool goes live. `drew` counts every effect produced on the way — it has to
 * stay at zero, because the trip is not a stroke (§4).
 */
function travel(
  m: WriteGestureMachine,
  at: WritingPoint,
  startNow: number,
  gesture: WriteGesture = "index",
): { now: number; drew: number } {
  let now = startNow;
  let drew = 0;
  const half: WritingPoint = { x: (TOOL.x + at.x) / 2, y: (TOOL.y + at.y) / 2 };
  for (const p of [half, at]) {
    now += 30;
    drew += step(m, { gesture, point: p, now }).effects.length;
  }
  now += T.settleMs + 1;
  drew += step(m, { gesture, point: at, now }).effects.length;
  return { now, drew };
}
/** A machine that has picked red, settled on the slide and is mid-stroke. */
function writing(): { m: WriteGestureMachine; now: number; at: WritingPoint } {
  const m = new WriteGestureMachine();
  pick(m, "color-0", 0);
  const settledAt = travel(m, MID, 10 + T.dwellMs).now;
  const at: WritingPoint = { x: MID.x + 0.03, y: MID.y };
  const now = settledAt + 30;
  step(m, { gesture: "index", point: at, now });
  return { m, now, at };
}

group("palette — five colours, in the toolbar's order (§2)", () => {
  ok(WRITING_COLORS.length === 5, `expected 5 colours, got ${WRITING_COLORS.length}`);
  ok(WRITING_COLOR_ORDER.length === 5, "five colour slots");
  ok(colorValue("color-0") === "#ef4444", `red first, got ${colorValue("color-0")}`);
  ok(colorValue("color-4") === "#ffffff", `white last, got ${colorValue("color-4")}`);
  ok(new Set(WRITING_COLORS).size === 5, "the colours are distinct");
});

group("toolbar — five colours, then Manual Eraser and Erase All (§2 §9 §10)", () => {
  ok(WRITE_TOOLBAR_ITEMS.length === 7, `expected 7 items, got ${WRITE_TOOLBAR_ITEMS.length}`);
  ok(
    WRITE_TOOLBAR_ITEMS.slice(0, 5).join(",") === WRITING_COLOR_ORDER.join(","),
    "the colours come first",
  );
  ok(WRITE_TOOLBAR_ITEMS[5] === "manual-eraser", "Manual Eraser is sixth");
  ok(WRITE_TOOLBAR_ITEMS[6] === "clear-all", "Erase All is last");
  ok(ERASER_MENU_ITEMS.length === 2, "there are exactly two eraser items");
  ok(
    ERASER_MENU_ITEMS[0] === "manual-eraser" && ERASER_MENU_ITEMS[1] === "clear-all",
    "and they are Manual Eraser then Erase All",
  );
});

group("geometry — distance from a point to a segment", () => {
  const a: WritingPoint = { x: 0, y: 0 };
  const b: WritingPoint = { x: 1, y: 0 };
  ok(Math.abs(distanceToSegment({ x: 0.5, y: 0.25 }, a, b) - 0.25) < 1e-9, "perpendicular");
  ok(Math.abs(distanceToSegment({ x: -0.5, y: 0 }, a, b) - 0.5) < 1e-9, "before the start");
  ok(Math.abs(distanceToSegment({ x: 1.5, y: 0 }, a, b) - 0.5) < 1e-9, "past the end");
  ok(distanceToSegment({ x: 0.4, y: 0 }, a, a) === 0.4, "a zero-length segment is a point");
});
group("geometry — a stroke is near the fingertip only where it really passes", () => {
  const stroke: WritingStroke = {
    id: "s1",
    color: "#ef4444",
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  };
  ok(strokeNearPoint(stroke, { x: 0.5, y: 0.51 }, 0.03), "a hit right on the line");
  ok(!strokeNearPoint(stroke, { x: 0.5, y: 0.7 }, 0.03), "a miss well above it");
  ok(!strokeNearPoint(stroke, { x: 0.05, y: 0.5 }, 0.03), "a miss beyond the end");
});

group("§9 — erasing only touches the overlay strokes under the fingertip", () => {
  let seq = 0;
  const nextId = () => `e${(seq += 1)}`;
  const line: WritingStroke = {
    id: "s1",
    color: "#ef4444",
    points: Array.from({ length: 11 }, (_, i) => ({ x: 0.1 + i * 0.08, y: 0.5 })),
  };
  const other: WritingStroke = {
    id: "s2",
    color: "#2563eb",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
    ],
  };
  const strokes = [line, other];

  const missed = eraseFromStrokes(strokes, { x: 0.5, y: 0.9 }, 0.035, nextId);
  ok(missed === strokes, "a miss returns the very same array, so nothing repaints");

  const cut = eraseFromStrokes(strokes, { x: 0.5, y: 0.5 }, 0.035, nextId);
  ok(cut !== strokes, "a hit returns a new array");
  ok(cut.includes(other), "the untouched stroke is kept by reference");
  ok(!cut.includes(line), "the hit stroke is replaced, not mutated");
  ok(line.points.length === 11, "and the original stroke object is left alone");
  const pieces = cut.filter((s) => s !== other);
  ok(pieces.length === 2, `a mid-line rub leaves two pieces, got ${pieces.length}`);
  ok(
    pieces.every((s) => s.color === "#ef4444"),
    "the pieces keep the ink colour",
  );
  ok(new Set(cut.map((s) => s.id)).size === cut.length, "every piece gets its own id");

  const end = eraseFromStrokes([other], { x: 0.3, y: 0.1 }, 0.035, nextId);
  ok(end.length === 0 || end.every((s) => s.points.length > 0), "no empty stroke survives");
});
group("§1 §5 — a raised index finger opens the toolbar and writes nothing", () => {
  const m = new WriteGestureMachine();
  const raised = step(m, { gesture: "index", point: MID, now: 1000 });
  ok(raised.toolbarOpen, "the toolbar opens on the raise");
  ok(raised.state === "toolbar", `state toolbar, got ${raised.state}`);
  ok(raised.effects.length === 0, "and absolutely nothing is drawn");
  ok(raised.cursorMode === "select", `the fingertip is a selector, got ${raised.cursorMode}`);
  ok(raised.tool === "pen" && raised.hovered === null, "no tool in use, nothing hovered");

  // Two seconds of wandering right across the slide, picking nothing.
  let drew = 0;
  let last = raised;
  for (let i = 1; i <= 40; i += 1) {
    last = step(m, {
      gesture: "index",
      point: { x: 0.15 + i * 0.016, y: 0.3 + (i % 5) * 0.02 },
      now: 1000 + i * 50,
    });
    drew += last.effects.length;
  }
  ok(drew === 0, `moving with no tool picked must write nothing, got ${drew} effects`);
  ok(last.toolbarOpen, "the toolbar never times out into writing");
  ok(last.state === "toolbar", "and the machine stays in tool selection");
});

group("§3 §7 — the cursor is exactly the fingertip sample that came in", () => {
  const m = new WriteGestureMachine();
  const p: WritingPoint = { x: 0.31, y: 0.62 };
  const f = step(m, { gesture: "index", point: p, now: 0 });
  ok(f.cursor === p, "the cursor is the index-tip sample itself, not a derived point");
  const g = step(m, { gesture: "none", point: null, now: 20 });
  ok(g.cursor === null && g.cursorMode === null, "no hand, no cursor");
});

group("§4 — dwelling on a colour arms it and the toolbar leaves", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "index", point: TOOL, now: 0 });
  const hovering = step(m, { gesture: "index", point: TOOL, hit: "color-2", now: 10 });
  ok(hovering.hovered === "color-2" && hovering.dwell === 0, "the dwell starts on hover");
  const early = step(m, { gesture: "index", point: TOOL, hit: "color-2", now: 10 + T.dwellMs - 1 });
  ok(early.effects.length === 0 && early.toolbarOpen, "nothing is picked before the dwell is up");
  ok(early.dwell > 0.9 && early.dwell < 1, `the dwell fills, got ${early.dwell.toFixed(3)}`);
  const picked = step(m, { gesture: "index", point: TOOL, hit: "color-2", now: 10 + T.dwellMs });
  ok(
    kinds(picked.effects) === "select-color",
    `expected select-color, got "${kinds(picked.effects)}"`,
  );
  const eff = picked.effects[0];
  ok(eff?.kind === "select-color" && eff.color === "color-2", "the chosen colour is reported");
  ok(!picked.toolbarOpen, "the toolbar disappears after the pick (§11)");
  ok(picked.state === "ready" && picked.tool === "pen", `armed and ready, got ${picked.state}`);
  ok(picked.hovered === null && picked.dwell === 0, "the hover clears with the toolbar");
  ok(picked.cursorMode === "pen", `the cursor becomes a pen, got ${picked.cursorMode}`);
});
group("§4 — the trip from the toolbar back to the slide leaves no mark", () => {
  const m = new WriteGestureMachine();
  pick(m, "color-0", 0);
  const { now, drew } = travel(m, MID, 10 + T.dwellMs);
  ok(drew === 0, `travelling after a pick must draw nothing, got ${drew} effects`);
  const armed = step(m, { gesture: "index", point: MID, now: now + 30 });
  ok(armed.effects.length === 0, "and a settled fingertip is still only a cursor");
  ok(armed.state === "ready" && armed.cursorMode === "pen", `ready pen, got ${armed.state}`);
});

group("§5 — a parked fingertip is a cursor, a deliberate move writes at once", () => {
  const m = new WriteGestureMachine();
  pick(m, "color-0", 0);
  const { now } = travel(m, MID, 10 + T.dwellMs);
  let drew = 0;
  let last: WriteFrame | null = null;
  for (let i = 1; i <= 12; i += 1) {
    last = step(m, {
      gesture: "index",
      point: { x: MID.x + (i % 2 === 1 ? 0.002 : -0.002), y: MID.y },
      now: now + i * 33,
    });
    drew += last.effects.length;
  }
  ok(drew === 0, `a trembling, parked fingertip must not write, got ${drew} effects`);
  ok(last?.state === "ready" && last?.cursorMode === "pen", "it stays a ready pen cursor");

  const begun = step(m, {
    gesture: "index",
    point: { x: MID.x + 0.04, y: MID.y },
    now: now + 12 * 33 + 30,
  });
  ok(
    kinds(begun.effects) === "begin,extend",
    `one deliberate move starts the stroke, got "${kinds(begun.effects)}"`,
  );
  ok(begun.state === "writing" && begun.cursorMode === "pen-active", "the machine is writing");
  const first = begun.effects[0];
  const second = begun.effects[1];
  ok(
    first?.kind === "begin" && first.point.x < MID.x + 0.04,
    "the stroke starts where the movement started, so no letter is clipped",
  );
  ok(
    second?.kind === "extend" && Math.abs(second.point.x - (MID.x + 0.04)) < 1e-9,
    "and reaches the fingertip in the very same frame — no trailing ink (§6)",
  );
});
group("§6 — ink tracks the fingertip, jitter is ignored, a jump re-joins", () => {
  const { m, now, at } = writing();
  const ext = step(m, { gesture: "index", point: { x: at.x + 0.02, y: at.y }, now: now + 30 });
  ok(kinds(ext.effects) === "extend", `movement extends the stroke, got "${kinds(ext.effects)}"`);
  const held = ext.effects[0];
  ok(held?.kind === "extend" && held.point.x === at.x + 0.02, "the ink sits on the fingertip");
  const jitter = step(m, { gesture: "index", point: { x: at.x + 0.0205, y: at.y }, now: now + 60 });
  ok(jitter.effects.length === 0, "sub-minStep jitter adds no point");
  ok(jitter.state === "writing", "but the stroke stays open");
  const jump = step(m, { gesture: "index", point: { x: at.x + 0.14, y: at.y }, now: now + 90 });
  ok(kinds(jump.effects) === "end,begin", `a tracking jump re-joins, got "${kinds(jump.effects)}"`);
});

group("§5 — holding still lifts the pen; moving again starts a fresh stroke", () => {
  const { m, now, at } = writing();
  const lifted = step(m, { gesture: "index", point: at, now: now + T.idleEndMs + 1 });
  ok(kinds(lifted.effects) === "end", `stillness lifts the pen, got "${kinds(lifted.effects)}"`);
  ok(lifted.state === "ready" && lifted.cursorMode === "pen", "back to a ready cursor");
  ok(!lifted.toolbarOpen, "and the toolbar does not jump back in the way (§11)");
  const again = step(m, {
    gesture: "index",
    point: { x: at.x, y: at.y - 0.05 },
    now: now + T.idleEndMs + 40,
  });
  ok(
    kinds(again.effects) === "begin,extend",
    `moving again writes a new stroke, got "${kinds(again.effects)}"`,
  );
});

group("§12 — one or two misread frames never disturb a stroke", () => {
  const { m, now, at } = writing();
  const f1 = step(m, { gesture: "eraser", point: at, now: now + 30 });
  const f2 = step(m, { gesture: "eraser", point: at, now: now + 60 });
  ok(!f1.toolbarOpen && !f2.toolbarOpen, "the toolbar stays away for a flicker");
  ok(f1.effects.length === 0 && f2.effects.length === 0, "and nothing is drawn or erased");
  ok(f2.state === "writing", "the open stroke survives the flicker");
});

group("§12 — a held index + middle brings the one toolbar back", () => {
  const { m, now, at } = writing();
  step(m, { gesture: "eraser", point: at, now: now + 30 });
  step(m, { gesture: "eraser", point: at, now: now + 60 });
  const f3 = step(m, { gesture: "eraser", point: at, now: now + 90 });
  ok(f3.toolbarOpen, "the third held frame re-opens the toolbar");
  ok(kinds(f3.effects) === "end", `the open stroke is closed cleanly, got "${kinds(f3.effects)}"`);
  ok(f3.state === "toolbar" && f3.cursorMode === "select", "the fingertip is a selector again");
});
group("§11 — a pick made with two fingers up does not re-open the toolbar", () => {
  const m = new WriteGestureMachine();
  const picked = pick(m, "clear-all", 0, "eraser");
  ok(kinds(picked.effects) === "clear", `Erase All fires once, got "${kinds(picked.effects)}"`);
  ok(!picked.toolbarOpen, "the toolbar leaves even though two fingers are still up");
  const pickedAt = 10 + T.dwellMs;
  let reopened = false;
  let drew = 0;
  for (const dt of [30, 60, 90, 200, 400]) {
    const f = step(m, { gesture: "eraser", point: TOOL, now: pickedAt + dt });
    reopened = reopened || f.toolbarOpen;
    drew += f.effects.length;
  }
  ok(!reopened, "holding index + middle does not re-open the toolbar it just used");
  ok(drew === 0, `and nothing is drawn or erased while it is held, got ${drew} effects`);

  // Lower the hand, raise index + middle again: that is a new raise, so it counts.
  step(m, { gesture: "none", point: null, now: pickedAt + 600 });
  step(m, { gesture: "none", point: null, now: pickedAt + 600 + T.lostMs + 1 });
  const again = step(m, { gesture: "eraser", point: TOOL, now: pickedAt + 900 });
  ok(again.toolbarOpen, "a fresh index + middle raise brings the toolbar back (§9 §12)");
});

group("§10 — Erase All clears the slide and hands the pointer back", () => {
  const m = new WriteGestureMachine();
  const done = pick(m, "clear-all", 0);
  ok(kinds(done.effects) === "clear", `expected clear, got "${kinds(done.effects)}"`);
  ok(!done.toolbarOpen, "the toolbar disappears (§11)");
  ok(done.state === "ready", `back to the normal pointer state, got ${done.state}`);
  ok(done.tool === "pen" && done.cursorMode === "pen", "with the pen — not the eraser — in hand");
  ok(travel(m, MID, 10 + T.dwellMs).drew === 0, "clearing does not leave the fingertip drawing");
});

group("§9 — Manual Eraser arms, rests, sweeps, then stops", () => {
  const m = new WriteGestureMachine();
  const armed = pick(m, "manual-eraser", 0);
  ok(
    kinds(armed.effects) === "select-eraser",
    `expected select-eraser, got "${kinds(armed.effects)}"`,
  );
  ok(armed.state === "eraser_ready" && armed.tool === "eraser", `armed, got ${armed.state}`);
  ok(!armed.toolbarOpen, "the toolbar disappears after the pick (§11)");
  ok(armed.cursorMode === "eraser", `the cursor becomes the eraser, got ${armed.cursorMode}`);

  const { now, drew } = travel(m, MID, 10 + T.dwellMs);
  ok(drew === 0, `carrying the eraser to the slide erases nothing, got ${drew} effects`);
  const rest = step(m, { gesture: "index", point: MID, now: now + 30 });
  ok(
    rest.effects.length === 0 && rest.state === "eraser_ready",
    "a resting eraser rubs nothing out",
  );
});
group("§9 — a sweeping eraser rubs out under the fingertip, and only there", () => {
  const m = new WriteGestureMachine();
  pick(m, "manual-eraser", 0);
  const { now } = travel(m, MID, 10 + T.dwellMs);
  const sweep = step(m, { gesture: "index", point: { x: MID.x + 0.03, y: MID.y }, now: now + 30 });
  ok(kinds(sweep.effects) === "erase", `a sweep erases, got "${kinds(sweep.effects)}"`);
  const rub = sweep.effects[0];
  ok(rub?.kind === "erase" && rub.point.x === MID.x + 0.03, "at the fingertip, not behind it");
  ok(sweep.state === "erasing" && sweep.cursorMode === "eraser-active", "the eraser is working");
  const more = step(m, { gesture: "index", point: { x: MID.x + 0.06, y: MID.y }, now: now + 60 });
  ok(kinds(more.effects) === "erase", "each step keeps rubbing");
  const jitter = step(m, {
    gesture: "index",
    point: { x: MID.x + 0.0605, y: MID.y },
    now: now + 90,
  });
  ok(jitter.effects.length === 0, "sub-minStep jitter does not rub twice");
  const stopped = step(m, {
    gesture: "index",
    point: { x: MID.x + 0.06, y: MID.y },
    now: now + 90 + T.idleEndMs + 1,
  });
  ok(stopped.effects.length === 0, "holding still stops erasing");
  ok(stopped.state === "eraser_ready" && stopped.tool === "eraser", "the eraser stays in hand");
  ok(!stopped.toolbarOpen, "and the toolbar stays out of the way (§11)");
});

group("§6 — a tracking blink is bridged, a real drop ends the stroke", () => {
  const { m, now, at } = writing();
  const blink = step(m, { gesture: "none", point: null, now: now + 30 });
  ok(blink.effects.length === 0, "a loss inside lostMs never ends the stroke");
  ok(blink.cursor === null && blink.cursorMode === null, "the cursor hides while the hand is gone");
  ok(blink.state === "writing", "the stroke is still open");
  const back = step(m, { gesture: "index", point: { x: at.x + 0.02, y: at.y }, now: now + 60 });
  ok(kinds(back.effects) === "extend", `the same stroke continues, got "${kinds(back.effects)}"`);

  const gone = step(m, { gesture: "none", point: null, now: now + 90 });
  ok(gone.effects.length === 0, "the drop is bridged first");
  const dropped = step(m, { gesture: "none", point: null, now: now + 90 + T.lostMs + 1 });
  ok(
    kinds(dropped.effects) === "end",
    `a real drop ends the stroke, got "${kinds(dropped.effects)}"`,
  );
  ok(dropped.state === "idle", "and the machine goes idle with the hand down");
  const stillIdle = step(m, { gesture: "none", point: null, now: now + 900 });
  ok(stillIdle.effects.length === 0 && stillIdle.state === "idle", "no repeated end effects");
});
group("§5 — a quick re-raise keeps the armed colour but still will not write by itself", () => {
  const { m, now, at } = writing();
  step(m, { gesture: "none", point: null, now: now + 30 });
  const endAt = now + 30 + T.lostMs + 1;
  const ended = step(m, { gesture: "none", point: null, now: endAt });
  ok(kinds(ended.effects) === "end", `the stroke ends first, got "${kinds(ended.effects)}"`);
  const resumed = step(m, { gesture: "index", point: at, now: endAt + 200 });
  ok(!resumed.toolbarOpen, "a quick re-raise does not re-open the toolbar");
  ok(
    resumed.state === "ready" && resumed.tool === "pen",
    `the colour is still armed, got ${resumed.state}`,
  );
  ok(resumed.effects.length === 0, "and the raise alone writes nothing (§1)");
  const settling = step(m, { gesture: "index", point: at, now: endAt + 200 + T.settleMs + 1 });
  ok(settling.effects.length === 0, "settling draws nothing either");
  const drawing = step(m, {
    gesture: "index",
    point: { x: at.x, y: at.y + 0.05 },
    now: endAt + 260 + T.settleMs,
  });
  ok(
    kinds(drawing.effects) === "begin,extend",
    `then a deliberate move writes again, got "${kinds(drawing.effects)}"`,
  );
});

group("§11 — a genuine pause offers the toolbar again", () => {
  const m = new WriteGestureMachine();
  pick(m, "color-1", 0);
  const t = travel(m, MID, 10 + T.dwellMs);
  step(m, { gesture: "none", point: null, now: t.now + 30 });
  const endAt = t.now + 30 + T.lostMs + 1;
  step(m, { gesture: "none", point: null, now: endAt });
  const paused = step(m, { gesture: "index", point: MID, now: endAt + T.resumeMs + 1 });
  ok(paused.toolbarOpen, "after longer than resumeMs the toolbar comes back");
  ok(paused.state === "toolbar" && paused.cursorMode === "select", "as a selector, not a pen");
  ok(paused.effects.length === 0, "and nothing is drawn while it is offered");
});

group("§12 — reset() drops everything a slide change must not keep", () => {
  const { m } = writing();
  m.reset();
  const idle = step(m, { gesture: "none", point: null, now: 9000 });
  ok(idle.effects.length === 0, "no dangling end effect after a reset");
  ok(idle.state === "idle" && idle.tool === "pen", "an idle machine with no tool armed");
  ok(idle.toolbarOpen === false && idle.hovered === null, "no toolbar, no hover");
  const raised = step(m, { gesture: "index", point: MID, now: 9010 });
  ok(raised.toolbarOpen, "the resume window is cleared, so raising offers the toolbar");
  ok(raised.effects.length === 0, "and still writes nothing (§1)");
});
console.log("");
if (failures.length > 0) {
  console.log(`${passed} checks passed, ${failures.length} failed:`);
  for (const line of failures) console.log(line);
  process.exit(1);
}
console.log(`${passed} checks passed.`);
