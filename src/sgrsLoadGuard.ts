/**
 * Debug guard: log immediately before sgrsAdapter loads sgrs-core (imported first in sgrsAdapter).
 */
// #region agent log
fetch("http://127.0.0.1:7243/ingest/43a26554-c058-4ee2-bffa-258ea712c1dc", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "346e93" }, body: JSON.stringify({ sessionId: "346e93", location: "sgrsLoadGuard.ts", message: "about to load sgrs-core", data: {}, timestamp: Date.now(), hypothesisId: "H1" }) }).catch(() => {});
// #endregion
export const __sgrsLoadGuard = true;
