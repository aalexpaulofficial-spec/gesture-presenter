import { useState, useEffect, useCallback } from "react";

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
  const isSafari =
    /safari/i.test(ua) &&
    !/chrome|chromium|edg|crios|fxios/i.test(ua);

  if (isMac && isSafari) return "mac_safari";

  if (/chrome|chromium|edg/i.test(ua)) return "desktop_chrome";

  return "generic";
}

function checkIsStandalone(): boolean {
  if (typeof window === "undefined") return false;

  const isStandaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
  const isIosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isAndroidApp = document.referrer.startsWith("android-app://");
  const storedInstalled = (() => {
    try {
      return localStorage.getItem("master_presenter_pwa_installed") === "true";
    } catch {
      return false;
    }
  })();

  return isStandaloneMedia || isIosStandalone || isAndroidApp || storedInstalled;
}

export function usePWAInstall() {
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<DevicePlatform>("generic");

  useEffect(() => {
    // 1. Detect platform
    setPlatform(detectPlatform());

    // 2. Initial standalone check
    if (checkIsStandalone()) {
      setIsInstalled(true);
    }

    // 3. Check if early captured prompt exists
    if (typeof window !== "undefined" && (window as any).__deferredPWAInstallPrompt) {
      setDeferredPrompt((window as any).__deferredPWAInstallPrompt);
    }

    // 4. Register callback for when early capturer receives event
    if (typeof window !== "undefined") {
      (window as any).__onPWAInstallAvailable = (promptEvent: BeforeInstallPromptEvent) => {
        setDeferredPrompt(promptEvent);
      };
    }

    // 5. Register Service Worker for offline PWA shell
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // 6. Query related apps if supported
    if ("getInstalledRelatedApps" in navigator) {
      (navigator as any)
        .getInstalledRelatedApps?.()
        .then((apps: any[]) => {
          if (Array.isArray(apps) && apps.length > 0) {
            setIsInstalled(true);
            try {
              localStorage.setItem("master_presenter_pwa_installed", "true");
            } catch {}
          }
        })
        .catch(() => {});
    }

    // 7. Watch for display-mode change
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const mediaHandler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        try {
          localStorage.setItem("master_presenter_pwa_installed", "true");
        } catch {}
      }
    };
    mediaQuery.addEventListener?.("change", mediaHandler);

    // 8. Listen for native beforeinstallprompt directly as well
    const installPromptHandler = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      (window as any).__deferredPWAInstallPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };
    window.addEventListener("beforeinstallprompt", installPromptHandler);

    // 9. Listen for appinstalled
    const installedHandler = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      if (typeof window !== "undefined") {
        (window as any).__deferredPWAInstallPrompt = null;
      }
      try {
        localStorage.setItem("master_presenter_pwa_installed", "true");
      } catch {}
    };
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      mediaQuery.removeEventListener?.("change", mediaHandler);
      window.removeEventListener("beforeinstallprompt", installPromptHandler);
      window.removeEventListener("appinstalled", installedHandler);
      if (typeof window !== "undefined") {
        (window as any).__onPWAInstallAvailable = null;
      }
    };
  }, []);

  const triggerInstall = useCallback(async (): Promise<PWAInstallResult> => {
    // Check if already installed
    if (isInstalled || checkIsStandalone()) {
      setIsInstalled(true);
      return "already_installed";
    }

    // Get prompt event from local state or global window
    let promptEvent =
      deferredPrompt ||
      (typeof window !== "undefined" ? (window as any).__deferredPWAInstallPrompt : null);

    // If not immediately available, wait up to 500ms in case it's currently resolving
    if (!promptEvent && typeof window !== "undefined") {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 500);
        const onPrompt = (e: Event) => {
          promptEvent = e as BeforeInstallPromptEvent;
          clearTimeout(timeout);
          window.removeEventListener("beforeinstallprompt", onPrompt);
          resolve();
        };
        window.addEventListener("beforeinstallprompt", onPrompt);
      });
      if (!promptEvent && typeof window !== "undefined") {
        promptEvent = (window as any).__deferredPWAInstallPrompt;
      }
    }

    // If native prompt is available, trigger native browser install prompt
    if (promptEvent) {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice.outcome === "accepted") {
          setIsInstalled(true);
          setDeferredPrompt(null);
          if (typeof window !== "undefined") {
            (window as any).__deferredPWAInstallPrompt = null;
          }
          try {
            localStorage.setItem("master_presenter_pwa_installed", "true");
          } catch {}
          return "installed";
        }
        return "dismissed";
      } catch (err) {
        console.error("Install prompt error:", err);
      }
    }

    // Otherwise show platform-specific instructions modal
    return "show_instructions";
  }, [isInstalled, deferredPrompt]);

  return {
    isInstalled,
    deferredPromptAvailable: !!deferredPrompt,
    platform,
    triggerInstall,
  };
}
