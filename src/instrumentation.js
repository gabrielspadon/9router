export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Rename process to distinguish 9router from generic next-server
    if (process.title.startsWith("next-server")) {
      process.title = process.title.replace("next-server", "9router");
    }

    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Boot-time schedulers. The layout-driven bootstrap (shared/services/
    // bootstrap.js) only fires on the first dashboard render, which never
    // happens on headless gateways — start here so background jobs run on
    // any entrypoint (standalone server.js, custom-server.js, dev).
    const { startFreeModelSync } =
      await import("@/shared/services/freeModelSync");
    startFreeModelSync().catch((e) =>
      console.error("[FreeModelSync] boot start failed:", e.message),
    );

    // Load user contextWindow overrides into the capabilities resolver so
    // /v1/models + request routing honor dashboard edits from boot.
    try {
      const [{ getSettings }, { setContextWindowOverrides }] =
        await Promise.all([
          import("@/lib/db/repos/settingsRepo.js"),
          import("open-sse/providers/capabilities.js"),
        ]);
      const settings = await getSettings();
      setContextWindowOverrides(settings.contextWindowOverrides || {});
    } catch (e) {
      console.warn("[context-overrides] boot load failed:", e?.message);
    }
  }
}
