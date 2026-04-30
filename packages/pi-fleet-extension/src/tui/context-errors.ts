export function isStaleExtensionContextError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("agent listener invoked outside active run")) return true;
  const mentionsExtensionCtx =
    message.includes("extensioncontext") ||
    message.includes("extension ctx") ||
    message.includes("extension context");
  const mentionsStaleSession =
    message.includes("stale") ||
    message.includes("session") ||
    message.includes("replacement") ||
    message.includes("reload");
  return mentionsExtensionCtx && mentionsStaleSession;
}
