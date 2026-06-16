import { request, type FullConfig } from "@playwright/test";

// Log in to Django once and save the session cookie so every test (and the SPA's
// /api/token/ call) is authenticated. Done over the request API (GET the CSRF
// token, then POST credentials) rather than the UI - robust and matches the
// working curl flow. The demo fixture ships admin/admin.
async function globalSetup(_config: FullConfig) {
  const base = process.env.E2E_BASE_URL || "http://127.0.0.1:18080";
  const ctx = await request.newContext({ baseURL: base });

  const loginHtml = await (await ctx.get("/data/login/")).text();
  const csrf = loginHtml.match(/csrfmiddlewaretoken" value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error("could not find csrfmiddlewaretoken on /data/login/");

  await ctx.post("/data/login/", {
    headers: { Referer: `${base}/data/login/` },
    form: {
      username: "admin",
      password: "admin",
      csrfmiddlewaretoken: csrf,
      next: "/",
    },
  });

  const state = await ctx.storageState();
  const hasSession = state.cookies.some((c) => c.name === "sessionid");
  if (!hasSession) {
    throw new Error(
      "login failed (no sessionid); cookies: " +
        state.cookies.map((c) => c.name).join(","),
    );
  }
  await ctx.storageState({ path: "storage.json" });
  await ctx.dispose();
}

export default globalSetup;
