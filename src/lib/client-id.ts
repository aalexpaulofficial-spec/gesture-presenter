/**
 * Stable anonymous client ID management.
 * Stored in localStorage so the same device / browser maintains
 * a consistent identity across sessions, deduplicating presenter
 * and download counts in Redis.
 */
export function getAnonymousClientId(): string {
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
