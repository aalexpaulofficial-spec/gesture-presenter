import { useState, useEffect, useCallback } from "react";
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
 * Module-level storage for beforeinstallprompt event.
 * Captures the event immediately when the script runs in the browser,
 * preventing any race condition between page load and React hydration.
 */
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  // Check if head inline script already captured it
  if ((window as any).__deferredPWAInstallPrompt) {
    globalDeferredPrompt = (window as any).__deferredPWAInstallPrompt;
  }

  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    const p = e as BeforeInstallPromptEvent;
    globalDeferredPrompt = p;
    (window as any).__deferredPWAInstallPrompt = p;
    if (typeof (window as any).__onPWAInstallAvailable === "function") {
      (window as any).__onPWAInstallAvailable(p);
    }
  });
}

/**
 * Real Installed-PWA detection.
 * Only returns true if the app is ACTUALLY running in standalone / fullscreen / minimal-ui.
 * A normal browser tab on Android, iOS, or Desktop ALWAYS returns false.
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

/**
 * Robust Android detection.
 * Correctly identifies Android phones, tablets, and Chromium instances,
 * including when "Desktop site" is checked.
 */
export function isAndroid(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  const navPlatform = ((navigator as any).platform || "").toLowerCase();
  const userAgentDataPlatform = ((navigator as any).userAgentData?.platform || "").toLowerCase();

  return (
    /android/.test(ua) ||
    /android/.test(navPlatform) ||
    userAgentDataPlatform === "android" ||
    ((/linux/.test(navPlatform) || userAgentDataPlatform === "linux") &&
      navigator.maxTouchPoints > 1 &&
      !/iphone|ipad|ipod|macintosh/.test(ua))
  );
}

/**
 * Robust iOS detection.
 */
export function isIos(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  const navPlatform = ((navigator as any).platform || "").toLowerCase();

  return (
    /iphone|ipad|ipod/.test(ua) ||
    (/macintel/.test(navPlatform) && navigator.maxTouchPoints > 1) ||
    (/macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function detectPlatform(): DevicePlatform {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "generic";
  }
  if (isIos()) return "ios";
  if (isAndroid()) return "android";

  const ua = (navigator.userAgent || "").toLowerCase();
  const isMac = /macintosh|mac os x/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|chromium|edg|crios|fxios/.test(ua);
  if (isMac && isSafari) return "mac_safari";
  if (/chrome|chromium|edg/.test(ua)) return "desktop_chrome";
  return "generic";
}

/**
 * Report a confirmed real PWA install to the backend.
 * Uses atomic Redis set `mp:installed_clients` on the server so that
 * a single client is counted exactly once in DOWNLOADS.
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
  const [hasPrompt, setHasPrompt] = useState<boolean>(() =>
    Boolean(globalDeferredPrompt || (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt))
  );

  const [installState, setInstallState] = useState<InstallationState>(() => {
    if (isAppInstalled()) return "INSTALLED";
    if (globalDeferredPrompt || (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt)) {
      return "INSTALL_PROMPT_AVAILABLE";
    }
    if (isIos()) return "MANUAL_INSTALL_REQUIRED";
    return "NOT_INSTALLED";
  });

  useEffect(() => {
    const currentPlatform = detectPlatform();
    setPlatform(currentPlatform);

    const installed = isAppInstalled();
    if (installed) {
      setInstallState("INSTALLED");
      const clientId = getAnonymousClientId();
      sendPwaDownloadRecord(clientId).catch(() => {});
    } else if (globalDeferredPrompt || (window as any).__deferredPWAInstallPrompt) {
      setInstallState("INSTALL_PROMPT_AVAILABLE");
      setHasPrompt(true);
    } else if (isIos()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
    }

    // Register callback for when beforeinstallprompt fires later
    (window as any).__onPWAInstallAvailable = (promptEvent: BeforeInstallPromptEvent) => {
      globalDeferredPrompt = promptEvent;
      setHasPrompt(true);
      if (!isAppInstalled()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };

    // Register Service Worker for offline capability
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const p = e as BeforeInstallPromptEvent;
      globalDeferredPrompt = p;
      (window as any).__deferredPWAInstallPrompt = p;
      setHasPrompt(true);
      if (!isAppInstalled()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // Listen for appinstalled — authoritative Chromium event when install finishes
    const onAppInstalled = () => {
      setInstallState("INSTALLED");
      globalDeferredPrompt = null;
      (window as any).__deferredPWAInstallPrompt = null;
      setHasPrompt(false);

      // Increment real Redis-backed DOWNLOADS count exactly once
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

  /**
   * Called directly when the user clicks "Free Download".
   *
   * Rules:
   * 1. Already installed → "already_installed"
   * 2. Native beforeinstallprompt exists → prompt.prompt() called IMMEDIATELY (no setTimeout!)
   *    - DO NOT open manual instructions modal!
   *    - If accepted → "prompt_accepted" (state becomes INSTALLING, awaits appinstalled)
   *    - If dismissed → "dismissed" (state returns to NOT_INSTALLED)
   * 3. No prompt:
   *    - iOS → "show_instructions_ios"
   *    - Android → "show_instructions_android"
   *    - Desktop/Other → "show_instructions_desktop"
   */
  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // CASE 1 — Already installed
    if (isAppInstalled()) {
      return "already_installed";
    }

    // CASE 2 — Native prompt available (Android / Chromium)
    const prompt =
      globalDeferredPrompt ||
      ((window as any).__deferredPWAInstallPrompt as BeforeInstallPromptEvent | null);

    if (prompt) {
      setInstallState("INSTALLING");
      try {
        // Must call synchronously within user gesture call stack
        await prompt.prompt();
        const choice = await prompt.userChoice;

        // Prompt is consumed — clear it
        globalDeferredPrompt = null;
        (window as any).__deferredPWAInstallPrompt = null;
        setHasPrompt(false);

        if (choice.outcome === "accepted") {
          // Keep state in INSTALLING until appinstalled fires
          return "prompt_accepted";
        } else {
          setInstallState("NOT_INSTALLED");
          return "dismissed";
        }
      } catch (err) {
        console.error("[usePWAInstall] prompt error:", err);
        globalDeferredPrompt = null;
        (window as any).__deferredPWAInstallPrompt = null;
        setHasPrompt(false);
      }
    }

    // CASE 3 — iOS (no beforeinstallprompt support)
    if (isIos()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
      return "show_instructions_ios";
    }

    // CASE 4 — Android without beforeinstallprompt
    if (isAndroid()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
      return "show_instructions_android";
    }

    // CASE 5 — Desktop / Other fallback
    setInstallState("MANUAL_INSTALL_REQUIRED");
    return "show_instructions_desktop";
  }, []);

  return {
    installState,
    isInstalled: installState === "INSTALLED",
    hasNativePrompt: hasPrompt,
    platform,
    triggerInstall,
    isAppInstalled,
    isAndroid,
    isIos,
  };
}
