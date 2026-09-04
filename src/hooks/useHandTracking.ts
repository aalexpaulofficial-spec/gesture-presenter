import { useCallback, useEffect, useRef, useState } from "react";
import {
  GestureGate,
  PointSmoother,
  classifyGesture,
  mapToSlide,
  type Gesture,
  type Landmark,
} from "@/lib/hand-control";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type CameraStatus = "idle" | "starting" | "live" | "error";
export type IndexFingerPoint = {
  slide: { x: number; y: number };
  screen: { x: number; y: number };
};

type Options = {
  enabled: boolean;
  onAction: (action: "next" | "prev") => void;
  onPointer: (point: { x: number; y: number } | null) => void;
  pointerMode?: "laser" | "writing";
  onWritePoint?: (point: { x: number; y: number } | null) => void;
  onIndexPoint?: (point: IndexFingerPoint | null) => void;
};

export function useHandTracking({
  enabled,
  onAction,
  onPointer,
  pointerMode = "laser",
  onWritePoint,
  onIndexPoint,
}: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<Gesture>("none");
  const [handVisible, setHandVisible] = useState(false);

  const actionRef = useRef(onAction);
  const pointerRef = useRef(onPointer);
  const writePointRef = useRef(onWritePoint);
  const indexPointRef = useRef(onIndexPoint);
  const pointerModeRef = useRef(pointerMode);
  actionRef.current = onAction;
  pointerRef.current = onPointer;
  writePointRef.current = onWritePoint;
  indexPointRef.current = onIndexPoint;
  pointerModeRef.current = pointerMode;

  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setStatus("idle");
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: {
      detectForVideo: (v: HTMLVideoElement, t: number) => unknown;
      close: () => void;
    } | null = null;
    const smoother = new PointSmoother();
    const gate = new GestureGate();
    let lastTs = -1;

    async function start() {
      setStatus("starting");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support camera access.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => undefined);

        const vision = await import("@mediapipe/tasks-vision");
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
        let created: Awaited<ReturnType<typeof vision.HandLandmarker.createFromOptions>>;
        try {
          created = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        } catch {
          created = await vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        }
        if (cancelled) {
          created.close();
          return;
        }
        landmarker = created as unknown as typeof landmarker;
        setStatus("live");

        const loop = () => {
          raf = requestAnimationFrame(loop);

          if (
            stream &&
            (!stream.active || stream.getTracks().some((t) => t.readyState === "ended"))
          ) {
            setAttempt((a) => a + 1);
            return;
          }

          const el = videoRef.current;
          if (!el || !landmarker || el.readyState < 2) return;
          const ts = el.currentTime * 1000;
          if (ts === lastTs) return;
          lastTs = ts;

          let result: { landmarks?: Landmark[][]; handedness?: { categoryName?: string }[][] };
          try {
            result = landmarker.detectForVideo(el, performance.now()) as typeof result;
          } catch {
            return;
          }
          const lm = result.landmarks?.[0];
          if (!lm) {
            setHandVisible(false);
            setGesture("none");
            smoother.reset();
            pointerRef.current(null);
            writePointRef.current?.(null);
            indexPointRef.current?.(null);
            gate.update("none", performance.now());
            return;
          }
          setHandVisible(true);
          const label = result.handedness?.[0]?.[0]?.categoryName ?? "Right";
          const g = classifyGesture(lm, label);
          setGesture(g);

          if (g === "pointing") {
            const tip = lm[8];
            if (tip) {
              const mapped = mapToSlide(tip.x, tip.y);
              const smoothed = smoother.next(mapped.x, mapped.y);
              indexPointRef.current?.({
                slide: smoothed,
                screen: {
                  x: (1 - tip.x) * window.innerWidth,
                  y: tip.y * window.innerHeight,
                },
              });
              if (pointerModeRef.current === "writing") {
                pointerRef.current(null);
                writePointRef.current?.(smoothed);
              } else {
                pointerRef.current(smoothed);
                writePointRef.current?.(null);
              }
            }
          } else {
            smoother.reset();
            pointerRef.current(null);
            writePointRef.current?.(null);
            indexPointRef.current?.(null);
          }

          const action = gate.update(g, performance.now());
          if (action) actionRef.current(action);
        };
        raf = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        const e = err as { name?: string; message?: string };
        const message =
          e.name === "NotAllowedError" || e.name === "SecurityError"
            ? "Camera access was blocked. Allow camera permission in your browser settings, then try again."
            : e.name === "NotFoundError" || e.name === "OverconstrainedError"
              ? "No usable camera was found on this device."
              : e.name === "NotReadableError"
                ? "Your camera is being used by another app. Close it and try again."
                : (e.message ?? "Camera could not be started.");
        setError(message);
        setStatus("error");
      }
    }

    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
      const el = videoRef.current;
      if (el) el.srcObject = null;
    };
  }, [enabled, attempt]);

  return { videoRef, status, error, gesture, handVisible, retry };
}
