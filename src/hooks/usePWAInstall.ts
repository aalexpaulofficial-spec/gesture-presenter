import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | "idle"          // not yet determined
  | "available"     // Android / desktop: native install prompt ready
  | "ios"           // iOS: show manual "Add to Home Screen" guide
  | "installed"     // already installed
  | "unsupported";  // browser does not support install

export function usePWAInstall() {
  const [state, setState] = useState<InstallState>("idle");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    // Check if already installed (standalone mode)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isStandalone) {
      setState("installed");
      return;
    }

    // Detect iOS (Safari doesn't support beforeinstallprompt)
    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isIos) {
      setState("ios");
      return;
    }

    // Android / Desktop: listen for native install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState("available");
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If no prompt fires in 3s on non-iOS, mark unsupported
    const timer = setTimeout(() => {
      setState((prev) => (prev === "idle" ? "unsupported" : prev));
    }, 3000);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      clearTimeout(timer);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setState("installed");
      setDeferredPrompt(null);
    }
  };

  return { state, triggerInstall };
}
