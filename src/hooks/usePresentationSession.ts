import { useEffect, useRef } from "react";

function getAnonymousClientId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let id = localStorage.getItem("mp_anonymous_client_id");
    if (!id) {
      id = "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("mp_anonymous_client_id", id);
    }
    return id;
  } catch {
    return "c_fallback_" + Date.now();
  }
}

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

  useEffect(() => {
    isPresentingRef.current = true;
    const clientId = getAnonymousClientId();
    const sessionId = getTabSessionId();

    const apiBase =
      typeof import.meta !== "undefined" && import.meta.env?.VITE_PRESENTATION_API_URL
        ? String(import.meta.env.VITE_PRESENTATION_API_URL).replace(/\/$/, "")
        : "";

    const heartbeatUrl = `${apiBase}/sessions/heartbeat`;
    const endUrl = `${apiBase}/sessions/end`;

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
      try {
        const payload = JSON.stringify({ client_id: clientId, session_id: sessionId });
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(endUrl, blob);
        } else {
          fetch(endUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
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
