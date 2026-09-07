import { useEffect, useRef } from "react";
import { getAnonymousClientId } from "@/lib/client-id";

function getTabSessionId(): string {
  if (typeof window === "undefined") return "session";
  try {
    let id = sessionStorage.getItem("mp_tab_session_id");
    if (!id) {
      id = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("mp_tab_session_id", id);
    }
    return id;
  } catch {
    return "s_fallback_" + Date.now();
  }
}

export function usePresentationSession() {
  const isPresentingRef = useRef(true);
  const sessionEndedRef = useRef(false);

  useEffect(() => {
    isPresentingRef.current = true;
    sessionEndedRef.current = false;
    const clientId = getAnonymousClientId();
    const sessionId = getTabSessionId();
    const startTime = Date.now();

    const apiBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESENTATION_API_URL
        ? String(import.meta.env.VITE_PRESENTATION_API_URL).replace(/\/$/, "")
        : "";

    const heartbeatUrl = `${apiBase}/sessions/heartbeat`;
    const endUrl = `${apiBase}/sessions/end`;
    const startStatsUrl = `${apiBase}/stats/session/start`;
    const endStatsUrl = `${apiBase}/stats/session/end`;

    // Record session start for cumulative statistics
    try {
      fetch(startStatsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, session_id: sessionId }),
      }).catch(() => {});
    } catch {
      // ignore
    }

    const sendHeartbeat = () => {
      if (!isPresentingRef.current) return;
      try {
        fetch(heartbeatUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, session_id: sessionId }),
        }).catch(() => {
          // Failure handling: do not disrupt presenter view if backend is temporarily unreachable
        });
      } catch {
        // ignore
      }
    };

    const sendEnd = () => {
      if (sessionEndedRef.current) return;
      sessionEndedRef.current = true;
      const durationSeconds = Math.max(0, Math.round((Date.now() - startTime) / 1000));
      const payload = JSON.stringify({ client_id: clientId, session_id: sessionId });
      const statsPayload = JSON.stringify({
        client_id: clientId,
        session_id: sessionId,
        duration_seconds: durationSeconds,
      });

      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(endUrl, blob);

          const statsBlob = new Blob([statsPayload], { type: "application/json" });
          navigator.sendBeacon(endStatsUrl, statsBlob);
        } else {
          fetch(endUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});

          fetch(endStatsUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: statsPayload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    // Immediate heartbeat upon opening presentation view
    sendHeartbeat();

    // Heartbeat every 10 seconds while presentation is active
    const interval = setInterval(sendHeartbeat, 10000);

    const handleBeforeUnload = () => {
      sendEnd();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    return () => {
      isPresentingRef.current = false;
      clearInterval(interval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      sendEnd();
    };
  }, []);
}

