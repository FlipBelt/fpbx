(() => {
  "use strict";

  if (!/^\/(?:index\.html)?$/.test(location.pathname)) return;

  const startedAt = Date.now();
  const timeoutMs = 30000;

  async function routeAllowedTester() {
    if (!state?.sessionToken) {
      if (Date.now() - startedAt < timeoutMs) window.setTimeout(routeAllowedTester, 250);
      return;
    }

    try {
      const params = new URLSearchParams({ session_token: state.sessionToken });
      const response = await fetch(`${getApiBase()}/api/v2/profile?${params}`, { cache: "no-store" });
      if (!response.ok) return;
      const profile = await response.json();
      if (profile.enabled) location.replace("/v2/");
    } catch (error) {
      console.warn(`V2 tester routing skipped: ${error.message}`);
    }
  }

  routeAllowedTester();
})();
