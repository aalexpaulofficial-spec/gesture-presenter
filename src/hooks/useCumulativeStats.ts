import { useState, useEffect } from "react";

export interface CumulativeStats {
  presenters: number;
  presentations_controlled: number;
  hours_presented: number;
  downloads: number;
}

export function useCumulativeStats(): CumulativeStats | null {
  const [stats, setStats] = useState<CumulativeStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apiBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESENTATION_API_URL
        ? String(import.meta.env.VITE_PRESENTATION_API_URL).replace(/\/$/, "")
        : "";

    const statsUrl = `${apiBase}/api/stats`;

    async function fetchStats() {
      try {
        const res = await fetch(statsUrl, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<CumulativeStats>;
        if (
          typeof data.presenters === "number" &&
          typeof data.presentations_controlled === "number" &&
          typeof data.hours_presented === "number" &&
          typeof data.downloads === "number" &&
          !cancelled
        ) {
          setStats({
            presenters: data.presenters,
            presentations_controlled: data.presentations_controlled,
            hours_presented: data.hours_presented,
            downloads: data.downloads,
          });
        }
      } catch {
        // Backend temporarily unavailable: keep previous state, never set fake numbers
      }
    }

    void fetchStats();

    // Lightweight periodic refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchStats();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return stats;
}
