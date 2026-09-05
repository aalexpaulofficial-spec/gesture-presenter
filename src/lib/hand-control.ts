/**
 * Gesture interpretation helpers for the camera hand-control engine.
 * Pure functions so they stay testable and framework free.
 */

export type Landmark = { x: number; y: number; z: number };
export type Gesture =
  | "none"
  | "fist"
  | "open-palm-front"
  | "open-palm-back"
  | "pointing"
  | "two-fingers";

const WRIST = 0;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_TIP = 20;

function at(lm: Landmark[], i: number): Landmark {
  return lm[i] ?? { x: 0, y: 0, z: 0 };
}

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Palm size, used to normalise finger-extension thresholds across cameras/distance. */
function palmSpan(lm: Landmark[]) {
  return Math.max(dist(at(lm, WRIST), at(lm, MIDDLE_MCP)), 1e-4);
}

function isExtended(lm: Landmark[], tip: number, pip: number) {
  return dist(at(lm, WRIST), at(lm, tip)) > dist(at(lm, WRIST), at(lm, pip)) * 1.18;
}

/**
 * Palm vs. back of hand. Uses the signed area of wrist -> index-mcp -> pinky-mcp,
 * combined with the handedness label reported by the tracker. The incoming video is
 * mirrored (selfie view), which the label already accounts for.
 */
export function palmFacesCamera(lm: Landmark[], handedness: string) {
  const v1x = at(lm, INDEX_MCP).x - at(lm, WRIST).x;
  const v1y = at(lm, INDEX_MCP).y - at(lm, WRIST).y;
  const v2x = at(lm, PINKY_MCP).x - at(lm, WRIST).x;
  const v2y = at(lm, PINKY_MCP).y - at(lm, WRIST).y;
  const cross = v1x * v2y - v1y * v2x;
  return handedness === "Left" ? cross > 0 : cross < 0;
}

export function classifyGesture(lm: Landmark[], handedness: string): Gesture {
  if (!lm || lm.length < 21) return "none";
  const span = palmSpan(lm);
  const index = isExtended(lm, INDEX_TIP, 6);
  const middle = isExtended(lm, MIDDLE_TIP, 10);
  const ring = isExtended(lm, RING_TIP, 14);
  const pinky = isExtended(lm, PINKY_TIP, 18);

  const spread = dist(at(lm, INDEX_TIP), at(lm, PINKY_TIP)) / span;

  // All fingers curled -> closed fist, used to reset between slide gestures.
  if (!index && !middle && !ring && !pinky) return "fist";

  // Index finger up, the rest curled -> laser pointer.
  if (index && !middle && !ring && !pinky) return "pointing";

  // Index + middle up, ring and pinky curled -> two-finger gesture. Master Write
  // uses this to open the eraser; slide navigation ignores it (see GestureGate).
  if (index && middle && !ring && !pinky) return "two-fingers";

  // All fingers extended and fanned out -> open hand; orientation picks direction.
  if (index && middle && ring && pinky && spread > 0.55) {
    return palmFacesCamera(lm, handedness) ? "open-palm-front" : "open-palm-back";
  }
  return "none";
}

/**
 * Maps a normalised fingertip coordinate from the camera frame onto the full slide
 * area. The comfortable movement range of a hand covers only the middle of the
 * frame, so that active window is stretched to the complete 0..1 slide range and
 * the horizontal axis is un-mirrored.
 */
export function mapToSlide(x: number, y: number) {
  const ax = 0.14;
  const ay = 0.12;
  const nx = (1 - x - ax) / (1 - ax * 2);
  const ny = (y - ay) / (1 - ay * 2);
  return {
    x: Math.min(1, Math.max(0, nx)),
    y: Math.min(1, Math.max(0, ny)),
  };
}

/** Low-latency one-euro-style smoothing: fast when moving, steady when still. */
export class PointSmoother {
  private px = 0;
  private py = 0;
  private started = false;
  private readonly base: number;
  private readonly gain: number;
  private readonly max: number;

  // Defaults reproduce the original laser feel exactly, so Master Hand / Master
  // Voice are untouched. Master Write passes a higher base + gain so ink tracks
  // the fingertip with far less lag (§4 low-latency requirement).
  constructor(base = 0.34, gain = 9, max = 0.9) {
    this.base = base;
    this.gain = gain;
    this.max = max;
  }

  reset() {
    this.started = false;
  }

  next(x: number, y: number) {
    if (!this.started) {
      this.px = x;
      this.py = y;
      this.started = true;
      return { x, y };
    }
    const speed = Math.hypot(x - this.px, y - this.py);
    const alpha = Math.min(this.max, this.base + speed * this.gain);
    this.px += (x - this.px) * alpha;
    this.py += (y - this.py) * alpha;
    return { x: this.px, y: this.py };
  }
}

/**
 * Debounces slide gestures so one hand movement never fires twice.
 * After a palm gesture fires, the user must close their hand into a fist
 * before the next palm gesture can trigger again.
 */
export class GestureGate {
  private last: Gesture = "none";
  private stable = 0;
  private firedAt = 0;
  private armed = true;

  constructor(
    private readonly framesRequired = 3,
    private readonly cooldownMs = 1100,
  ) {}

  /** Returns the action to run, or null. */
  update(gesture: Gesture, now: number): "next" | "prev" | null {
    if (gesture !== this.last) {
      this.last = gesture;
      this.stable = 0;
    }
    this.stable += 1;

    if (gesture === "fist") {
      this.armed = true;
      return null;
    }
    if (gesture === "none" || gesture === "pointing" || gesture === "two-fingers") return null;
    if (!this.armed || this.stable < this.framesRequired) return null;
    if (now - this.firedAt < this.cooldownMs) return null;

    this.firedAt = now;
    this.armed = false;
    return gesture === "open-palm-front" ? "next" : "prev";
  }
}

export const gestureLabel: Record<Gesture, string> = {
  none: "Waiting for hand",
  fist: "Closed fist — gesture reset",
  "open-palm-front": "Front palm — next slide",
  "open-palm-back": "Back palm — previous slide",
  pointing: "Index finger — laser",
  "two-fingers": "Two fingers",
};
