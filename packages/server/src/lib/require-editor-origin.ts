import type { Request, Response, NextFunction } from "express";

/**
 * Reject browser cross-origin requests to state-changing routes.
 *
 * A drive-by page the user happens to visit while TVE is running can
 * `fetch()` our localhost API (CORS is permissive). The browser stamps
 * every such request with the attacker page's `Origin`, which JavaScript
 * cannot forge. We allow only the editor's own origin (and the server's
 * own origin) through; anything else is refused.
 *
 * Requests with NO `Origin` header are allowed: top-level navigations,
 * same-origin simple requests, and non-browser callers (tests, the CLI,
 * server-to-server) are not the browser-CSRF threat this guards against.
 * The OAuth `start`/`callback` GET navigations — which carry no usable
 * `Origin` — are protected by the CSRF `state` nonce in routes/auth.ts
 * instead, not by this middleware.
 */
export function allowedEditorOrigins(): string[] {
  const editor = (process.env.TVE_EDITOR_URL || "http://localhost:3005").replace(
    /\/+$/,
    ""
  );
  const port = Number(process.env.PORT) || 3011;
  return [editor, `http://localhost:${port}`, `http://127.0.0.1:${port}`];
}

export function requireEditorOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const origin = req.get("origin");
  if (!origin) {
    next();
    return;
  }
  if (allowedEditorOrigins().includes(origin)) {
    next();
    return;
  }
  res
    .status(403)
    .json({ error: "Cross-origin request rejected", code: "forbidden-origin" });
}
