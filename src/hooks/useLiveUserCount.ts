import { useState, useEffect } from "react";

export function useLiveUserCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apiBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESENTATION_API_URL
        ? String(import.meta.env.VITE_PRESENTATION_API_URL).replace(/\/$/, "")
        : "";

    const statsUrl = `${apiBase}/stats/live`;

    async function fetchStats() {
      try {
        const res = await fetch(statsUrl, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { active_users?: number };
        if (typeof data.active_users === "number" && !cancelled) {
          setCount(data.active_users);
        }
      } catch {
        // Backend temporarily unavailable: do not invent fake numbers, preserve state
      }
    }

    void fetchStats();

    // Poll periodically every 10 seconds without hammering the backend
    const interval = setInterval(fetchStats, 10000);

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

  return count;
}
