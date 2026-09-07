import { useState, useEffect, useRef, useCallback } from "react";
import { getAnonymousClientId } from "@/lib/client-id";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallationState =
  | "NOT_INSTALLED"
  | "INSTALL_PROMPT_AVAILABLE"
  | "INSTALLING"
  | "INSTALLED"
  | "MANUAL_INSTALL_REQUIRED"
  | "UNSUPPORTED";

export type PWAInstallResult =
  | "already_installed"
  | "prompt_accepted"
  | "dismissed"
  | "show_instructions_ios"
  | "show_instructions_android"
  | "show_instructions_desktop";

export type DevicePlatform =
  | "ios"
  | "android"
  | "desktop_chrome"
  | "mac_safari"
  | "generic";

/**
 * Real Installed-PWA detection.
 *
 * Rules:
 *   - window.matchMedia("(display-mode: standalone)").matches
 *   - window.matchMedia("(display-mode: fullscreen)").matches
 *   - window.matchMedia("(display-mode: minimal-ui)").matches
 *   - window.navigator.standalone === true (iOS Safari standalone)
 *
 * NEVER uses:
 *   - localStorage / sessionStorage
 *   - user-agent checks
 *   - referrer checks
 *
 * A normal browser tab MUST and DOES return false.
 */
export function isAppInstalled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    const isFullscreen = window.matchMedia("(display-mode: fullscreen)").matches;
    const isMinimalUi = window.matchMedia("(display-mode: minimal-ui)").matches;
    const isIosStandalone = (window.navigator as any).standalone === true;
    return Boolean(isStandalone || isFullscreen || isMinimalUi || isIosStandalone);
  } catch {
    return false;
  }
}

export function detectPlatform(): DevicePlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "generic";
  }
  const ua = navigator.userAgent || "";
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIos) return "ios";
  if (/android/i.test(ua)) return "android";
  const isMac = /macintosh|mac os x/i.test(ua);
  const isSafari = /safari/i.test(ua) && !/chrome|chromium|edg|crios|fxios/i.test(ua);
  if (isMac && isSafari) return "mac_safari";
  if (/chrome|chromium|edg/i.test(ua)) return "desktop_chrome";
  return "generic";
}

/**
 * Report a confirmed real PWA install to the backend.
 * Uses the stable anonymous client ID so Redis SADD mp:installed_clients
 * ensures idempotent deduplication (one real device = 1 download count).
 */
export async function sendPwaDownloadRecord(clientId: string): Promise<void> {
  if (typeof window === "undefined" || !clientId) return;
  const apiBase =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESENTATION_API_URL
      ? String(import.meta.env.VITE_PRESENTATION_API_URL).replace(/\/$/, "")
      : "";
  const url = `${apiBase}/api/stats/download`;
  try {
    const payload = JSON.stringify({ client_id: clientId });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
    } else {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  } catch {
    // ignore
  }
}

export function usePWAInstall() {
  const [platform, setPlatform] = useState<DevicePlatform>("generic");
  const [installState, setInstallState] = useState<InstallationState>(() =>
    isAppInstalled() ? "INSTALLED" : "NOT_INSTALLED"
  );

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const currentPlatform = detectPlatform();
    setPlatform(currentPlatform);

    const installed = isAppInstalled();
    if (installed) {
      setInstallState("INSTALLED");
      // If launched in standalone mode, record the installation idempotently in Redis
      const clientId = getAnonymousClientId();
      sendPwaDownloadRecord(clientId).catch(() => {});
    } else if (currentPlatform === "ios") {
      // iOS has no beforeinstallprompt; uninstalled iOS users require manual Add to Home Screen
      setInstallState("MANUAL_INSTALL_REQUIRED");
    }

    // Pick up early prompt if captured in window
    const earlyPrompt = (window as any).__deferredPWAInstallPrompt as
      | BeforeInstallPromptEvent
      | null
      | undefined;
    if (earlyPrompt && !installed) {
      deferredPromptRef.current = earlyPrompt;
      setInstallState("INSTALL_PROMPT_AVAILABLE");
    }

    (window as any).__onPWAInstallAvailable = (promptEvent: BeforeInstallPromptEvent) => {
      deferredPromptRef.current = promptEvent;
      if (!isAppInstalled()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };

    // Register Service Worker for offline capability
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // Listen for beforeinstallprompt
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const prompt = e as BeforeInstallPromptEvent;
      (window as any).__deferredPWAInstallPrompt = prompt;
      deferredPromptRef.current = prompt;
      if (!isAppInstalled()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // Listen for appinstalled — authoritative signal of real Chromium PWA install
    const onAppInstalled = () => {
      setInstallState("INSTALLED");
      deferredPromptRef.current = null;
      (window as any).__deferredPWAInstallPrompt = null;

      // Report confirmed download to backend
      const clientId = getAnonymousClientId();
      sendPwaDownloadRecord(clientId).catch(() => {});
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // Watch display-mode changes
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setInstallState("INSTALLED");
        const clientId = getAnonymousClientId();
        sendPwaDownloadRecord(clientId).catch(() => {});
      }
    };
    mq.addEventListener?.("change", onMqChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mq.removeEventListener?.("change", onMqChange);
      (window as any).__onPWAInstallAvailable = null;
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // 1. Real standalone check
    if (isAppInstalled() || installState === "INSTALLED") {
      return "already_installed";
    }

    // 2. Native install prompt (Chromium on Android / Desktop)
    let prompt =
      deferredPromptRef.current ??
      ((window as any).__deferredPWAInstallPrompt as BeforeInstallPromptEvent | null) ??
      null;

    if (!prompt) {
      // Brief grace period for first page load in Chromium
      prompt = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener("beforeinstallprompt", handler);
          resolve(null);
        }, 500);
        const handler = (e: Event) => {
          e.preventDefault();
          clearTimeout(timer);
          const p = e as BeforeInstallPromptEvent;
          (window as any).__deferredPWAInstallPrompt = p;
          deferredPromptRef.current = p;
          window.removeEventListener("beforeinstallprompt", handler);
          resolve(p);
        };
        window.addEventListener("beforeinstallprompt", handler);
      });
    }

    if (prompt) {
      setInstallState("INSTALLING");
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;

        deferredPromptRef.current = null;
        (window as any).__deferredPWAInstallPrompt = null;

        if (outcome === "accepted") {
          // Keep in installing/waiting until appinstalled event fires
          return "prompt_accepted";
        }

        // User dismissed
        setInstallState("NOT_INSTALLED");
        return "dismissed";
      } catch (err) {
        console.error("[usePWAInstall] prompt error:", err);
      }
    }

    // 3. No native prompt available → show platform-specific manual instructions
    const currentPlatform = detectPlatform();
    setInstallState("MANUAL_INSTALL_REQUIRED");

    if (currentPlatform === "ios") {
      return "show_instructions_ios";
    }
    if (currentPlatform === "android") {
      return "show_instructions_android";
    }
    return "show_instructions_desktop";
  }, [installState]);

  return {
    installState,
    isInstalled: installState === "INSTALLED",
    platform,
    triggerInstall,
    isAppInstalled,
  };
}
