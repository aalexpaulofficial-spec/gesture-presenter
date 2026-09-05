/**
 * Master Write — gesture + geometry test (index / index+middle scheme).
 *
 * Dependency-free: run with Node 24+, which strips the type annotations from
 * the imported module directly. src/lib/writing.ts pulls in no React, DOM or
 * camera code, so the whole surface can be exercised in a plain process.
 *
 *   node scripts/writing-gestures.test.ts
 */

import {
  ERASER_MENU_ITEMS,
  WRITE_TIMINGS,
  WRITING_COLORS,
  WRITING_COLOR_ORDER,
  WriteGestureMachine,
  colorValue,
  distanceToSegment,
  eraseFromStrokes,
  strokeNearPoint,
  type WriteEffect,
  type WriteFrame,
  type WriteSample,
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

/** Effect kinds in order, as a comma string, for easy comparison. */
function kinds(effects: WriteEffect[]): string {
  return effects.map((e) => e.kind).join(",");
}
/** Build a full sample from a partial one, filling the common defaults. */
function sample(over: Partial<WriteSample> & { now: number }): WriteSample {
  return {
    gesture: over.gesture ?? "index",
    point: over.point ?? null,
    overMenu: over.overMenu ?? false,
    hit: over.hit ?? null,
    now: over.now,
  };
}

/** Run one update and return the whole frame. */
function step(m: WriteGestureMachine, over: Partial<WriteSample> & { now: number }): WriteFrame {
  return m.update(sample(over));
}

const T = WRITE_TIMINGS;

// ---------------------------------------------------------------------------

group("palette — exactly five colours, white is last (§2 §6)", () => {
  ok(WRITING_COLORS.length === 5, `expected 5 colors, got ${WRITING_COLORS.length}`);
  ok(WRITING_COLORS[0] === "#ef4444", "color-0 is red");
  ok(WRITING_COLORS[4] === "#ffffff", "color-4 is white");
  ok(
    WRITING_COLOR_ORDER.length === 5,
    `expected 5 colours in order, got ${WRITING_COLOR_ORDER.length}`,
  );
  ok(colorValue("color-2") === WRITING_COLORS[2], "colorValue maps color-2");
  ok(colorValue("color-4") === "#ffffff", "colorValue maps color-4 to white");
});

group("eraser controls — Manual Eraser then Erase All (§6)", () => {
  ok(ERASER_MENU_ITEMS.length === 2, `expected 2 eraser items, got ${ERASER_MENU_ITEMS.length}`);
  ok(ERASER_MENU_ITEMS[0] === "manual-eraser", "manual eraser is first");
  ok(ERASER_MENU_ITEMS[1] === "clear-all", "erase all is second");
});
group("distanceToSegment (§8 geometry)", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 1, y: 0 };
  ok(distanceToSegment({ x: 0.5, y: 0 }, a, b) === 0, "point on segment → 0");
  ok(
    Math.abs(distanceToSegment({ x: 0.5, y: 0.25 }, a, b) - 0.25) < 1e-9,
    "perpendicular distance",
  );
  ok(
    Math.abs(distanceToSegment({ x: -0.3, y: 0 }, a, b) - 0.3) < 1e-9,
    "beyond start clamps to endpoint",
  );
  ok(Math.abs(distanceToSegment({ x: 2, y: 0 }, a, b) - 1) < 1e-9, "beyond end clamps to endpoint");
  const p = { x: 0.2, y: 0.4 };
  const deg = distanceToSegment(p, { x: 0, y: 0 }, { x: 0, y: 0 });
  ok(Math.abs(deg - Math.hypot(0.2, 0.4)) < 1e-9, "degenerate segment → distance to the point");
});

group("strokeNearPoint (§8)", () => {
  const dot: WritingStroke = { id: "s", color: "#fff", points: [{ x: 0.5, y: 0.5 }] };
  ok(strokeNearPoint(dot, { x: 0.5, y: 0.52 }, 0.035), "single point within radius");
  ok(!strokeNearPoint(dot, { x: 0.5, y: 0.7 }, 0.035), "single point outside radius");
  const line: WritingStroke = {
    id: "l",
    color: "#fff",
    points: [
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
    ],
  };
  ok(strokeNearPoint(line, { x: 0.5, y: 0.5 }, 0.02), "near the middle of a segment");
  ok(!strokeNearPoint(line, { x: 0.5, y: 0.9 }, 0.02), "far from the segment");
});
group("eraseFromStrokes (§7 clear / §8 partial / §18 identity)", () => {
  let n = 0;
  const makeId = () => `e${(n += 1)}`;

  const horizontal = (): WritingStroke[] => [
    {
      id: "h",
      color: "#fff",
      points: Array.from({ length: 9 }, (_, i) => ({ x: 0.1 + i * 0.1, y: 0.5 })),
    },
  ];

  const untouched = horizontal();
  ok(
    eraseFromStrokes(untouched, { x: 0.5, y: 0.9 }, 0.035, makeId) === untouched,
    "miss returns same ref",
  );

  const split = eraseFromStrokes(horizontal(), { x: 0.5, y: 0.5 }, 0.035, makeId);
  ok(split.length === 2, `middle erase → 2 pieces, got ${split.length}`);
  ok(
    split.every((s) => s.points.length >= 2),
    "both pieces keep at least two points",
  );
  ok(
    !split.some((s) => s.points.some((p) => Math.abs(p.x - 0.5) < 1e-9)),
    "the erased point is gone",
  );

  const tiny: WritingStroke[] = [
    {
      id: "t",
      color: "#fff",
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.51, y: 0.5 },
      ],
    },
  ];
  ok(
    eraseFromStrokes(tiny, { x: 0.505, y: 0.5 }, 0.035, makeId).length === 0,
    "a small stroke is fully erased",
  );

  const other: WritingStroke = { id: "keep", color: "#fff", points: [{ x: 0.9, y: 0.9 }] };
  const two = eraseFromStrokes([tiny[0]!, other], { x: 0.505, y: 0.5 }, 0.035, makeId);
  ok(two.length === 1 && two[0] === other, "an unrelated stroke is preserved by reference");
});

const PAL = { x: 0.5, y: 0.92 }; // a spot inside the open colour palette
const EPAL = { x: 0.5, y: 0.92 }; // a spot inside the open eraser controls
group("machine — a lone index finger opens the colour palette (§2 §15)", () => {
  const m = new WriteGestureMachine();
  const f = step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: 1000 });
  ok(f.colorMenuOpen, "the colour palette opens on raise");
  ok(!f.eraserMenuOpen, "the eraser controls stay closed");
  ok(f.state === "color_menu", `state color_menu, got ${f.state}`);
  ok(f.effects.length === 0, "nothing is drawn yet");
});

group("machine — dwelling on a colour selects it and closes the palette (§3 §6)", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "index", point: PAL, now: 0 });
  const hovering = step(m, {
    gesture: "index",
    point: PAL,
    overMenu: true,
    hit: "color-2",
    now: 10,
  });
  ok(hovering.hovered === "color-2" && hovering.dwell === 0, "the dwell starts on hover");
  const early = step(m, {
    gesture: "index",
    point: PAL,
    overMenu: true,
    hit: "color-2",
    now: 10 + T.dwellMs - 1,
  });
  ok(early.effects.length === 0 && early.colorMenuOpen, "no selection before the dwell elapses");
  ok(early.dwell > 0.9 && early.dwell < 1, `the dwell approaches 1, got ${early.dwell.toFixed(3)}`);
  const picked = step(m, {
    gesture: "index",
    point: PAL,
    overMenu: true,
    hit: "color-2",
    now: 10 + T.dwellMs,
  });
  ok(
    kinds(picked.effects) === "select-color",
    `expected select-color, got "${kinds(picked.effects)}"`,
  );
  const eff = picked.effects[0];
  ok(eff?.kind === "select-color" && eff.color === "color-2", "the chosen colour is reported");
  ok(!picked.colorMenuOpen, "the palette closes after selection (§15)");
});
group("machine — an unused palette times out and the pen takes over (§4 §15)", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: 0 });
  const waiting = step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: T.paletteMs - 100 });
  ok(waiting.colorMenuOpen && waiting.effects.length === 0, "the palette stays open while unused");
  const takeover = step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: T.paletteMs + 1 });
  ok(!takeover.colorMenuOpen, "the palette closes once the timeout passes");
  ok(
    kinds(takeover.effects) === "begin",
    `the pen begins after timeout, got "${kinds(takeover.effects)}"`,
  );
});

group("machine — writing begins, extends, ignores jitter and re-joins jumps (§4 §18)", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "index", point: PAL, now: 0 });
  step(m, { gesture: "index", point: PAL, overMenu: true, hit: "color-0", now: 10 });
  step(m, { gesture: "index", point: PAL, overMenu: true, hit: "color-0", now: 10 + T.dwellMs }); // select

  const stillNear = step(m, { gesture: "index", point: PAL, now: 600 });
  ok(stillNear.effects.length === 0, "no ink before escaping the palette spot");

  const begun = step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: 610 });
  ok(
    kinds(begun.effects) === "begin",
    `the stroke begins once clear, got "${kinds(begun.effects)}"`,
  );

  const extended = step(m, { gesture: "index", point: { x: 0.51, y: 0.5 }, now: 620 });
  ok(kinds(extended.effects) === "extend", `movement extends, got "${kinds(extended.effects)}"`);

  const jitter = step(m, { gesture: "index", point: { x: 0.5105, y: 0.5 }, now: 630 });
  ok(jitter.effects.length === 0, "sub-minStep jitter is ignored");

  const jump = step(m, { gesture: "index", point: { x: 0.75, y: 0.5 }, now: 640 });
  ok(kinds(jump.effects) === "end,begin", `a wide jump re-joins, got "${kinds(jump.effects)}"`);
});
group("machine — index + middle opens the eraser controls, never the palette (§6)", () => {
  const m = new WriteGestureMachine();
  const f = step(m, { gesture: "eraser", point: { x: 0.5, y: 0.5 }, now: 0 });
  ok(f.eraserMenuOpen, "the eraser controls open on the two-finger raise");
  ok(!f.colorMenuOpen, "the colour palette never opens for the eraser");
  ok(f.state === "eraser_menu", `state eraser_menu, got ${f.state}`);
  ok(f.effects.length === 0, "nothing is erased just by opening the controls");
});

group("machine — Manual Eraser arms, then rubs out under the fingertip (§8)", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "eraser", point: EPAL, now: 0 });
  step(m, { gesture: "eraser", point: EPAL, overMenu: true, hit: "manual-eraser", now: 10 });
  const armed = step(m, {
    gesture: "eraser",
    point: EPAL,
    overMenu: true,
    hit: "manual-eraser",
    now: 10 + T.dwellMs,
  });
  ok(armed.state === "erasing", `the eraser arms → erasing, got ${armed.state}`);
  ok(armed.effects.length === 0, "arming alone erases nothing (it escapes the control first)");
  const e1 = step(m, { gesture: "eraser", point: { x: 0.5, y: 0.4 }, now: 600 });
  ok(kinds(e1.effects) === "erase", `movement erases, got "${kinds(e1.effects)}"`);
  const e2 = step(m, { gesture: "eraser", point: { x: 0.52, y: 0.4 }, now: 610 });
  ok(kinds(e2.effects) === "erase", "each fingertip step keeps erasing");
});

group("machine — Erase All fires once, then sits idle (§7)", () => {
  const m = new WriteGestureMachine();
  step(m, { gesture: "eraser", point: EPAL, now: 0 });
  step(m, { gesture: "eraser", point: EPAL, overMenu: true, hit: "clear-all", now: 10 });
  const done = step(m, {
    gesture: "eraser",
    point: EPAL,
    overMenu: true,
    hit: "clear-all",
    now: 10 + T.dwellMs,
  });
  ok(kinds(done.effects) === "clear", `expected clear, got "${kinds(done.effects)}"`);
  ok(!done.eraserMenuOpen, "the controls close after Erase All");
  ok(done.state === "eraser_idle", "Erase All leaves the machine idle, not erasing");
  const idle = step(m, { gesture: "eraser", point: { x: 0.3, y: 0.3 }, now: 700 });
  ok(idle.effects.length === 0, "no stray erasing after Erase All until the fingers drop");
});
/** Drive a fresh machine to an open stroke via the palette-timeout path. */
function machineWithOpenStroke(): WriteGestureMachine {
  const m = new WriteGestureMachine();
  step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: 0 });
  step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: T.paletteMs + 1 }); // begin
  return m;
}

group("machine — a tracking blink is bridged, a real drop ends the stroke (§5)", () => {
  const m = machineWithOpenStroke();
  const blink = step(m, { gesture: "none", point: null, now: T.paletteMs + 10 });
  ok(blink.effects.length === 0, "a brief loss inside lostMs never ends the stroke");
  const dropped = step(m, { gesture: "none", point: null, now: T.paletteMs + 10 + T.lostMs + 1 });
  ok(
    kinds(dropped.effects) === "end",
    `a longer drop ends the stroke, got "${kinds(dropped.effects)}"`,
  );
  ok(dropped.state === "idle", "the machine returns to idle when the finger is down");
});

/** Lower the finger and hold past the grace window so the stroke ends. */
function lowerUntilEnded(m: WriteGestureMachine, startNow: number): WriteFrame {
  step(m, { gesture: "none", point: null, now: startNow });
  return step(m, { gesture: "none", point: null, now: startNow + T.lostMs + 1 });
}

group("machine — raising again inside resumeMs keeps writing, no palette (§5 §15)", () => {
  const m = machineWithOpenStroke();
  const ended = lowerUntilEnded(m, T.paletteMs + 10);
  ok(kinds(ended.effects) === "end", "the stroke ended before the resume test");
  const endAt = T.paletteMs + 10 + T.lostMs + 1;
  const resumed = step(m, { gesture: "index", point: { x: 0.4, y: 0.4 }, now: endAt + 50 });
  ok(!resumed.colorMenuOpen, "no palette when resuming quickly");
  ok(
    kinds(resumed.effects) === "begin",
    `writing resumes straight away, got "${kinds(resumed.effects)}"`,
  );
  ok(resumed.state === "writing", "back in the writing state");
});
group("machine — a real pause offers the palette again (§15)", () => {
  const m = machineWithOpenStroke();
  lowerUntilEnded(m, T.paletteMs + 10);
  const endAt = T.paletteMs + 10 + T.lostMs + 1;
  const paused = step(m, {
    gesture: "index",
    point: { x: 0.4, y: 0.4 },
    now: endAt + T.resumeMs + 1,
  });
  ok(paused.colorMenuOpen, "the palette re-opens after a genuine pause");
  ok(paused.effects.length === 0, "nothing is drawn while the palette is offered");
});

group("machine — reset() drops the in-flight stroke (§17 slide change)", () => {
  const m = machineWithOpenStroke();
  m.reset();
  const afterReset = step(m, { gesture: "none", point: null, now: 5000 });
  ok(afterReset.effects.length === 0, "no dangling end effect after reset");
  ok(afterReset.state === "idle", "reset leaves the machine idle");
  const raised = step(m, { gesture: "index", point: { x: 0.5, y: 0.5 }, now: 5010 });
  ok(raised.colorMenuOpen, "reset clears resume state, so raising offers the palette");
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exitCode = 1;
}
