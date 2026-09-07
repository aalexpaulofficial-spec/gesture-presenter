import { useState, useEffect, useRef, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type PWAInstallResult =
  | "already_installed"
  | "installed"
  | "dismissed"
  | "show_instructions";

export type DevicePlatform =
  | "ios"
  | "android"
  | "desktop_chrome"
  | "mac_safari"
  | "generic";

function detectPlatform(): DevicePlatform {
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
 * Returns true ONLY when the app is genuinely running in PWA standalone mode.
 *
 * Sources of truth (real browser signals only):
 *   - window.matchMedia("(display-mode: standalone)").matches   — Chrome / Edge / Android
 *   - window.navigator.standalone === true                       — iOS Safari
 *   - document.referrer.startsWith("android-app://")            — Android TWA
 *
 * Intentionally excluded (NOT reliable):
 *   - localStorage / sessionStorage flags
 *   - Service worker registration status
 *   - navigator.serviceWorker.controller
 *   - getInstalledRelatedApps (not trustworthy cross-browser)
 *   - Any button click or page visit
 */
function checkRealStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const androidTwa = document.referrer.startsWith("android-app://");
  return standaloneMedia || iosStandalone || androidTwa;
}

export function usePWAInstall() {
  // ── State ──────────────────────────────────────────────────────────────────
  //
  // isInstalled is set to true ONLY by:
  //   1. checkRealStandaloneMode() on mount (running as installed PWA)
  //   2. The native "appinstalled" browser event
  //   3. The display-mode media query changing to standalone
  //
  // It is NEVER set from localStorage, button clicks, or service worker state.
  const [isInstalled, setIsInstalled] = useState<boolean>(
    () => (typeof window !== "undefined" ? checkRealStandaloneMode() : false)
  );

  const [platform, setPlatform] = useState<DevicePlatform>("generic");

  // Use a ref so triggerInstall always has the most current prompt, even when
  // the component re-renders before the async prompt resolves.
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  // Expose a boolean so components can conditionally show install UI
  const [hasInstallPrompt, setHasInstallPrompt] = useState<boolean>(false);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    // 1. Detect platform
    setPlatform(detectPlatform());

    // 2. Re-check real standalone mode now that we're in the browser
    if (checkRealStandaloneMode()) {
      setIsInstalled(true);
    }

    // 3. Pick up any prompt captured by the inline <script> in <head> before
    //    React mounted (the script runs synchronously before hydration)
    const earlyPrompt = (window as any).__deferredPWAInstallPrompt as
      | BeforeInstallPromptEvent
      | null
      | undefined;
    if (earlyPrompt) {
      deferredPromptRef.current = earlyPrompt;
      setHasInstallPrompt(true);
    }

    // 4. Register a callback so the inline script can hand us future events
    (window as any).__onPWAInstallAvailable = (
      promptEvent: BeforeInstallPromptEvent
    ) => {
      deferredPromptRef.current = promptEvent;
      setHasInstallPrompt(true);
    };

    // 5. Register Service Worker (offline capability only — not an install signal)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // 6. Listen for beforeinstallprompt (fires when browser is ready to prompt)
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // suppress mini-infobar on mobile Chrome
      const prompt = e as BeforeInstallPromptEvent;
      (window as any).__deferredPWAInstallPrompt = prompt;
      deferredPromptRef.current = prompt;
      setHasInstallPrompt(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    // 7. Listen for appinstalled — the REAL signal the PWA was installed
    const onAppInstalled = () => {
      setIsInstalled(true);
      // Clear the prompt; it has been consumed
      deferredPromptRef.current = null;
      (window as any).__deferredPWAInstallPrompt = null;
      setHasInstallPrompt(false);
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // 8. Watch display-mode changes (e.g. user opens installed PWA later)
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMqChange = (e: MediaQueryListEvent) => {
      if (e.matches) setIsInstalled(true);
    };
    mq.addEventListener?.("change", onMqChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      mq.removeEventListener?.("change", onMqChange);
      (window as any).__onPWAInstallAvailable = null;
    };
  }, []);

  // ── triggerInstall ─────────────────────────────────────────────────────────
  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // ── Step 1: check REAL standalone mode (never localStorage) ──────────────
    if (checkRealStandaloneMode() || isInstalled) {
      return "already_installed";
    }

    // ── Step 2: get the native install prompt ─────────────────────────────────
    let prompt =
      deferredPromptRef.current ??
      ((window as any).__deferredPWAInstallPrompt as BeforeInstallPromptEvent | null) ??
      null;

    // Step 2b: wait briefly in case the browser fires the event just after
    //          the user clicked (common on first page load in Chrome)
    if (!prompt) {
      prompt = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
        const timer = setTimeout(() => {
          window.removeEventListener("beforeinstallprompt", handler);
          resolve(null);
        }, 800);
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

    // ── Step 3: fire the native prompt if we have it ─────────────────────────
    if (prompt) {
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;

        // Prompt is single-use — clear it regardless of outcome
        deferredPromptRef.current = null;
        (window as any).__deferredPWAInstallPrompt = null;
        setHasInstallPrompt(false);

        if (outcome === "accepted") {
          // Do NOT mark as installed here — wait for the real "appinstalled" event.
          // Return "installed" so the UI can show a success/confirmation dialog.
          return "installed";
        }

        // User tapped "Cancel" / "Not now" — they are NOT installed.
        // Do NOT say "already_installed".
        return "dismissed";
      } catch (err) {
        console.error("[usePWAInstall] prompt() threw:", err);
      }
    }

    // ── Step 4: no native prompt, not installed → show manual instructions ────
    // NEVER return "already_installed" here. Absence of beforeinstallprompt
    // does NOT mean the app is installed.
    return "show_instructions";
  }, [isInstalled]);

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    /** True only when genuinely running as an installed standalone PWA. */
    isInstalled,
    /** True when the browser has a capturable install prompt ready. */
    hasInstallPrompt,
    /** Alias kept for backward compatibility */
    deferredPromptAvailable: hasInstallPrompt,
    platform,
    triggerInstall,
  };
}
