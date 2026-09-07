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

// ─── Module-level singletons ────────────────────────────────────────────────

/**
 * The deferred install prompt captured before React hydration.
 */
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

/**
 * TRUE once we have reliable evidence the PWA is installed on this device.
 *
 * Set by any of:
 *  - display-mode: standalone / fullscreen / minimal-ui (running as PWA)
 *  - navigator.standalone === true (iOS Safari PWA)
 *  - navigator.getInstalledRelatedApps() returning this app (Chrome 84+)
 *  - the browser's `appinstalled` event firing
 *
 * Never set by localStorage or any fake flag.
 */
let globalInstallConfirmed = false;

/**
 * React state updaters registered by mounted hook instances.
 * Allows the async installed check to push state into React.
 */
const _installConfirmedListeners: Array<() => void> = [];

function _fireInstallConfirmed(): void {
  globalInstallConfirmed = true;
  _installConfirmedListeners.forEach((cb) => cb());
}

/**
 * Async check using navigator.getInstalledRelatedApps().
 *
 * Chrome 84+ (Android + Desktop) can reliably report whether a PWA
 * listed in `related_applications` in manifest.json is installed —
 * even when the user is in a NORMAL BROWSER TAB, not the PWA itself.
 *
 * Requires manifest.json to have:
 *   "related_applications": [{ "platform": "webapp", "url": "<manifest-url>" }]
 *
 * This is started immediately when the module loads so the result is
 * cached long before the user taps "Free Download".
 */
async function _checkInstalledRelatedApps(): Promise<void> {
  if (typeof navigator === "undefined") return;

  // Already known via sync display-mode check
  if (isAppInstalled()) {
    _fireInstallConfirmed();
    return;
  }

  // getInstalledRelatedApps — available Chrome 84+ Android / Chrome 85+ Desktop
  if (!("getInstalledRelatedApps" in navigator)) return;

  try {
    const apps: unknown[] = await (navigator as any).getInstalledRelatedApps();
    if (Array.isArray(apps) && apps.length > 0) {
      _fireInstallConfirmed();
    }
  } catch {
    // API failed — ignore, fall back to display-mode and event-based detection
  }
}

// ─── Module-level initialization (browser only) ─────────────────────────────

if (typeof window !== "undefined") {
  // Capture beforeinstallprompt if the head inline script already got it
  if ((window as any).__deferredPWAInstallPrompt) {
    globalDeferredPrompt = (window as any).__deferredPWAInstallPrompt;
  }

  // Listen for any future beforeinstallprompt
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    const p = e as BeforeInstallPromptEvent;
    globalDeferredPrompt = p;
    (window as any).__deferredPWAInstallPrompt = p;
    if (typeof (window as any).__onPWAInstallAvailable === "function") {
      (window as any).__onPWAInstallAvailable(p);
    }
  });

  // Start the async getInstalledRelatedApps check right away so that
  // the result is ready before the user taps the button.
  _checkInstalledRelatedApps().catch(() => {});
}

// ─── Exported helpers ────────────────────────────────────────────────────────

/**
 * Synchronous display-mode check.
 *
 * Returns TRUE only when running as an installed PWA
 * (standalone / fullscreen / minimal-ui window, or iOS standalone).
 *
 * A normal browser tab always returns FALSE.
 * Do NOT use this alone as proof of non-installation.
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
 * Returns TRUE if installation has been confirmed by ANY reliable signal
 * this session (display-mode, getInstalledRelatedApps, or appinstalled event).
 */
export function isInstallConfirmed(): boolean {
  return globalInstallConfirmed || isAppInstalled();
}

/**
 * Robust Android detection — handles tablets and "Desktop site" mode.
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
 * Robust iOS detection — handles iPad Pro with Mac UA.
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
 * Report a confirmed PWA install to the backend (idempotent via Redis SADD).
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

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePWAInstall() {
  const [platform, setPlatform] = useState<DevicePlatform>("generic");
  const [hasPrompt, setHasPrompt] = useState<boolean>(() =>
    Boolean(globalDeferredPrompt || (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt))
  );

  const [installState, setInstallState] = useState<InstallationState>(() => {
    // Installed state has highest priority — check both sync and cached async result
    if (isInstallConfirmed()) return "INSTALLED";
    if (
      globalDeferredPrompt ||
      (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt)
    ) {
      return "INSTALL_PROMPT_AVAILABLE";
    }
    if (isIos()) return "MANUAL_INSTALL_REQUIRED";
    return "NOT_INSTALLED";
  });

  useEffect(() => {
    const currentPlatform = detectPlatform();
    setPlatform(currentPlatform);

    // ── Sync check ────────────────────────────────────────────────────────
    if (isInstallConfirmed()) {
      setInstallState("INSTALLED");
    } else if (globalDeferredPrompt || (window as any).__deferredPWAInstallPrompt) {
      setInstallState("INSTALL_PROMPT_AVAILABLE");
      setHasPrompt(true);
    } else if (isIos()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
    }

    // ── Async result from getInstalledRelatedApps ─────────────────────────
    // Register listener so when the async check completes (or already has),
    // React state is updated immediately.
    const onInstallConfirmed = () => {
      setInstallState("INSTALLED");
      setHasPrompt(false);
    };
    _installConfirmedListeners.push(onInstallConfirmed);

    // If the async check already finished before this component mounted
    if (globalInstallConfirmed) {
      setInstallState("INSTALLED");
    }

    // ── beforeinstallprompt callback ──────────────────────────────────────
    (window as any).__onPWAInstallAvailable = (promptEvent: BeforeInstallPromptEvent) => {
      globalDeferredPrompt = promptEvent;
      setHasPrompt(true);
      if (!isInstallConfirmed()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };

    // ── Service Worker registration ───────────────────────────────────────
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // ── beforeinstallprompt listener ──────────────────────────────────────
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const p = e as BeforeInstallPromptEvent;
      globalDeferredPrompt = p;
      (window as any).__deferredPWAInstallPrompt = p;
      setHasPrompt(true);
      if (!isInstallConfirmed()) {
        setInstallState("INSTALL_PROMPT_AVAILABLE");
      }
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // ── appinstalled listener — authoritative Chromium signal ─────────────
    const onAppInstalled = () => {
      // Record the real installation in Redis (idempotent)
      const clientId = getAnonymousClientId();
      sendPwaDownloadRecord(clientId).catch(() => {});

      // Mark as confirmed and notify all listeners
      _fireInstallConfirmed();
      globalDeferredPrompt = null;
      (window as any).__deferredPWAInstallPrompt = null;
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // ── display-mode change listener ──────────────────────────────────────
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        const clientId = getAnonymousClientId();
        sendPwaDownloadRecord(clientId).catch(() => {});
        _fireInstallConfirmed();
      }
    };
    mq.addEventListener?.("change", onMqChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mq.removeEventListener?.("change", onMqChange);
      (window as any).__onPWAInstallAvailable = null;

      // Remove our listener
      const idx = _installConfirmedListeners.indexOf(onInstallConfirmed);
      if (idx !== -1) _installConfirmedListeners.splice(idx, 1);
    };
  }, []);

  /**
   * Called directly when the user clicks "Free Download".
   *
   * Priority order (INSTALLED always wins):
   *
   * 1. isInstallConfirmed() → "already_installed" (covers PWA context AND
   *    browser-tab-after-install via getInstalledRelatedApps result)
   * 2. Native prompt available → prompt.prompt() SYNCHRONOUSLY in gesture
   *    - accepted → "prompt_accepted" (state stays INSTALLING until appinstalled)
   *    - dismissed → "dismissed"
   * 3. No prompt:
   *    - iOS → "show_instructions_ios"
   *    - Android → "show_instructions_android"
   *    - Desktop → "show_instructions_desktop"
   */
  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // ── HIGHEST PRIORITY: already installed ───────────────────────────────
    // isInstallConfirmed() covers:
    //   • display-mode standalone (running as PWA)
    //   • globalInstallConfirmed set by getInstalledRelatedApps or appinstalled
    if (isInstallConfirmed()) {
      setInstallState("INSTALLED");
      return "already_installed";
    }

    // ── Native prompt (Android / Desktop Chrome) ──────────────────────────
    // NOTE: prompt.prompt() MUST be called synchronously inside the user-gesture
    // call stack. Any await before this call (other than checking installed state
    // from the already-resolved promise) will break the user activation token.
    const prompt =
      globalDeferredPrompt ||
      ((window as any).__deferredPWAInstallPrompt as BeforeInstallPromptEvent | null);

    if (prompt) {
      setInstallState("INSTALLING");
      try {
        await prompt.prompt(); // synchronous relative to gesture — OK
        const choice = await prompt.userChoice;

        // Prompt is now consumed — clear it
        globalDeferredPrompt = null;
        (window as any).__deferredPWAInstallPrompt = null;
        setHasPrompt(false);

        if (choice.outcome === "accepted") {
          // Stay in INSTALLING until `appinstalled` event fires
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

    // If no native prompt was available, check getInstalledRelatedApps directly
    // in case the initial async check has not resolved yet.
    if (typeof navigator !== "undefined" && "getInstalledRelatedApps" in navigator) {
      try {
        const apps: unknown[] = await (navigator as any).getInstalledRelatedApps();
        if (Array.isArray(apps) && apps.length > 0) {
          _fireInstallConfirmed();
          setInstallState("INSTALLED");
          return "already_installed";
        }
      } catch {
        // ignore
      }
    }

    if (isInstallConfirmed()) {
      setInstallState("INSTALLED");
      return "already_installed";
    }

    // ── No native prompt — show platform instructions ─────────────────────
    if (isIos()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
      return "show_instructions_ios";
    }

    if (isAndroid()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
      return "show_instructions_android";
    }

    setInstallState("MANUAL_INSTALL_REQUIRED");
    return "show_instructions_desktop";
  }, []);

  return {
    installState,
    isInstalled: installState === "INSTALLED" || isInstallConfirmed(),
    hasNativePrompt: hasPrompt,
    platform,
    triggerInstall,
    isAppInstalled,
    isInstallConfirmed,
    isAndroid,
    isIos,
  };
}
