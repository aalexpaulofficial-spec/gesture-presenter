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

// ─── Same-Origin Persistent Installation Record ─────────────────────────────
const INSTALL_RECORD_KEY = "mp_pwa_installed_record";

export interface PersistedInstallRecord {
  installed: boolean;
  installedAt: number;
  clientId: string;
  source: "appinstalled" | "standalone_detection" | "related_apps";
}

export function getPersistedInstallRecord(): PersistedInstallRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(INSTALL_RECORD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.installed === true) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function markPwaAsInstalled(source: PersistedInstallRecord["source"]): void {
  if (typeof window === "undefined") return;
  try {
    const clientId = getAnonymousClientId();
    const record: PersistedInstallRecord = {
      installed: true,
      installedAt: Date.now(),
      clientId,
      source,
    };
    localStorage.setItem(INSTALL_RECORD_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable or restricted
  }
}

export function clearPersistedInstallRecord(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(INSTALL_RECORD_KEY);
  } catch {
    // ignore
  }
}

// ─── Module-level singletons ────────────────────────────────────────────────

/**
 * The deferred install prompt captured before or after React hydration.
 */
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

/**
 * TRUE once we have reliable evidence the PWA is installed on this device.
 */
let globalInstallConfirmed = false;

/**
 * React state updaters registered by mounted hook instances.
 * Allows async or event-driven checks to push state into React.
 */
const _installConfirmedListeners: Array<() => void> = [];

function _fireInstallConfirmed(): void {
  globalInstallConfirmed = true;
  _installConfirmedListeners.forEach((cb) => cb());
}

/**
 * Real installed-PWA signals:
 * Check if the CURRENT PAGE is running inside an installed PWA.
 */
export function isRunningAsInstalledPWA(): boolean {
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

/** Backward compatibility alias */
export const isAppInstalled = isRunningAsInstalledPWA;

/**
 * Robust check: is the app installed on this device / browser?
 * Priority:
 * 1. isRunningAsInstalledPWA() (real standalone window)
 * 2. in-memory session confirmation (appinstalled fired this session)
 * 3. Contradictory check: if an active beforeinstallprompt is ready to be fired,
 *    the browser explicitly tells us the app is NOT installed!
 * 4. Persisted same-origin installation record from a genuine install event
 *    (appinstalled, running standalone previously, or getInstalledRelatedApps).
 */
export function isInstallationConfirmed(): boolean {
  if (typeof window === "undefined") return false;

  // 1. Current context is genuinely running as installed PWA
  if (isRunningAsInstalledPWA()) {
    markPwaAsInstalled("standalone_detection");
    return true;
  }

  // 2. Global in-memory signal (set during this session)
  if (globalInstallConfirmed) {
    return true;
  }

  // 3. Contradictory signal check: if beforeinstallprompt is currently active and waiting,
  // the browser explicitly says the app is NOT installed!
  const hasActivePrompt = Boolean(
    globalDeferredPrompt ||
      (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt)
  );
  if (hasActivePrompt) {
    return false;
  }

  // 4. Persisted installation record from real past installation (appinstalled or standalone run)
  const persisted = getPersistedInstallRecord();
  if (persisted && persisted.installed === true) {
    return true;
  }

  return false;
}

/** Backward compatibility alias */
export const isInstallConfirmed = isInstallationConfirmed;

/**
 * Async check using navigator.getInstalledRelatedApps().
 */
async function _checkInstalledRelatedApps(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;

  if (isRunningAsInstalledPWA()) {
    markPwaAsInstalled("standalone_detection");
    _fireInstallConfirmed();
    return true;
  }

  if (!("getInstalledRelatedApps" in navigator)) return false;

  try {
    const apps: unknown[] = await (navigator as any).getInstalledRelatedApps();
    if (Array.isArray(apps) && apps.length > 0) {
      markPwaAsInstalled("related_apps");
      _fireInstallConfirmed();
      return true;
    }
  } catch {
    // API not available or errored
  }
  return false;
}

// ─── Module-level initialization (browser only) ─────────────────────────────

if (typeof window !== "undefined") {
  // If running as standalone PWA on load, mark persisted record immediately
  if (isRunningAsInstalledPWA()) {
    markPwaAsInstalled("standalone_detection");
    globalInstallConfirmed = true;
  } else if (isInstallationConfirmed()) {
    globalInstallConfirmed = true;
  }

  // Capture beforeinstallprompt if the head inline script already got it
  if ((window as any).__deferredPWAInstallPrompt) {
    globalDeferredPrompt = (window as any).__deferredPWAInstallPrompt;
  }

  // Listen for beforeinstallprompt
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    // When beforeinstallprompt fires, the browser tells us the app is NOT installed!
    clearPersistedInstallRecord();
    globalInstallConfirmed = false;

    e.preventDefault();
    const p = e as BeforeInstallPromptEvent;
    globalDeferredPrompt = p;
    (window as any).__deferredPWAInstallPrompt = p;
    if (typeof (window as any).__onPWAInstallAvailable === "function") {
      (window as any).__onPWAInstallAvailable(p);
    }
  });

  // Listen for authoritative appinstalled event
  window.addEventListener("appinstalled", () => {
    const clientId = getAnonymousClientId();
    sendPwaDownloadRecord(clientId).catch(() => {});
    markPwaAsInstalled("appinstalled");
    _fireInstallConfirmed();
    globalDeferredPrompt = null;
    (window as any).__deferredPWAInstallPrompt = null;
  });

  // Start the async getInstalledRelatedApps check right away
  _checkInstalledRelatedApps().catch(() => {});
}

// ─── Device / Platform Helpers ──────────────────────────────────────────────

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
    Boolean(
      globalDeferredPrompt ||
        (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt)
    )
  );

  // State Priority:
  // 1. INSTALLED (highest priority — NEVER overridden by MANUAL_INSTALL_REQUIRED)
  // 2. INSTALL_PROMPT_AVAILABLE
  // 3. MANUAL_INSTALL_REQUIRED
  // 4. NOT_INSTALLED
  const [installState, setInstallState] = useState<InstallationState>(() => {
    if (isInstallationConfirmed()) return "INSTALLED";
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

    // Initial sync check on mount
    if (isInstallationConfirmed()) {
      setInstallState("INSTALLED");
      setHasPrompt(false);
    } else if (globalDeferredPrompt || (window as any).__deferredPWAInstallPrompt) {
      setInstallState("INSTALL_PROMPT_AVAILABLE");
      setHasPrompt(true);
    } else if (isIos()) {
      setInstallState("MANUAL_INSTALL_REQUIRED");
    }

    // Register callback for when install confirmation occurs
    const onInstallConfirmed = () => {
      setInstallState("INSTALLED");
      setHasPrompt(false);
    };
    _installConfirmedListeners.push(onInstallConfirmed);

    if (isInstallationConfirmed()) {
      setInstallState("INSTALLED");
    }

    // beforeinstallprompt callback
    (window as any).__onPWAInstallAvailable = (promptEvent: BeforeInstallPromptEvent) => {
      // Browser provided a prompt -> app is not installed
      clearPersistedInstallRecord();
      globalInstallConfirmed = false;
      globalDeferredPrompt = promptEvent;
      setHasPrompt(true);
      setInstallState("INSTALL_PROMPT_AVAILABLE");
    };

    // Service Worker registration
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // beforeinstallprompt listener
    const onBeforeInstallPrompt = (e: Event) => {
      clearPersistedInstallRecord();
      globalInstallConfirmed = false;
      e.preventDefault();
      const p = e as BeforeInstallPromptEvent;
      globalDeferredPrompt = p;
      (window as any).__deferredPWAInstallPrompt = p;
      setHasPrompt(true);
      setInstallState("INSTALL_PROMPT_AVAILABLE");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // appinstalled listener — authoritative Chromium signal
    const onAppInstalled = () => {
      const clientId = getAnonymousClientId();
      sendPwaDownloadRecord(clientId).catch(() => {});
      markPwaAsInstalled("appinstalled");
      _fireInstallConfirmed();
      globalDeferredPrompt = null;
      (window as any).__deferredPWAInstallPrompt = null;
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // display-mode change listener
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        const clientId = getAnonymousClientId();
        sendPwaDownloadRecord(clientId).catch(() => {});
        markPwaAsInstalled("standalone_detection");
        _fireInstallConfirmed();
      }
    };
    mq.addEventListener?.("change", onMqChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mq.removeEventListener?.("change", onMqChange);
      (window as any).__onPWAInstallAvailable = null;

      const idx = _installConfirmedListeners.indexOf(onInstallConfirmed);
      if (idx !== -1) _installConfirmedListeners.splice(idx, 1);
    };
  }, []);

  /**
   * Called directly when the user clicks "Free Download".
   *
   * Logic runs in this exact order:
   * STEP 1: Check whether the current context is an installed PWA (isRunningAsInstalledPWA()).
   *         If TRUE: show "Already Installed" and STOP.
   * STEP 2: Check the persisted successful installation state for this
   *         Master Presenter origin/application.
   *         If TRUE and there is no contradictory browser state:
   *         show "Already Installed" and STOP.
   * STEP 3: If NOT installed and beforeinstallprompt is available:
   *         launch native installation prompt.
   * STEP 4: If installation prompt is unavailable:
   *         only then determine the correct manual-install fallback.
   */
  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // ── STEP 1: Check whether current context is an installed PWA ─────────
    if (isRunningAsInstalledPWA()) {
      markPwaAsInstalled("standalone_detection");
      _fireInstallConfirmed();
      setInstallState("INSTALLED");
      return "already_installed";
    }

    // ── STEP 2: Check persisted / confirmed installation state ────────────
    if (isInstallationConfirmed()) {
      setInstallState("INSTALLED");
      return "already_installed";
    }

    // Direct check via getInstalledRelatedApps if available and no prompt exists
    const prompt =
      globalDeferredPrompt ||
      ((window as any).__deferredPWAInstallPrompt as BeforeInstallPromptEvent | null);

    if (!prompt && typeof navigator !== "undefined" && "getInstalledRelatedApps" in navigator) {
      try {
        const apps: unknown[] = await (navigator as any).getInstalledRelatedApps();
        if (Array.isArray(apps) && apps.length > 0) {
          markPwaAsInstalled("related_apps");
          _fireInstallConfirmed();
          setInstallState("INSTALLED");
          return "already_installed";
        }
      } catch {
        // ignore
      }
    }

    if (isInstallationConfirmed()) {
      setInstallState("INSTALLED");
      return "already_installed";
    }

    // ── STEP 3: If NOT installed and beforeinstallprompt is available ──────
    if (prompt) {
      setInstallState("INSTALLING");
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;

        globalDeferredPrompt = null;
        (window as any).__deferredPWAInstallPrompt = null;
        setHasPrompt(false);

        if (choice.outcome === "accepted") {
          // Await appinstalled event for final confirmation
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

    // ── STEP 4: If installation prompt is unavailable: manual fallback ─────
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
    isInstalled: installState === "INSTALLED" || isInstallationConfirmed(),
    hasNativePrompt: hasPrompt,
    platform,
    triggerInstall,
    isAppInstalled,
    isRunningAsInstalledPWA,
    isInstallationConfirmed,
    isInstallConfirmed,
    isAndroid,
    isIos,
  };
}
