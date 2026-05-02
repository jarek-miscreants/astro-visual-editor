import { Router, type Express, type Request, type Response } from "express";
import http from "http";
import type { Server as HttpServer } from "http";
import {
  startDevServer,
  stopDevServer,
  getDevServerStatus,
  DevServerStartFailure,
} from "../services/astro-dev-server.js";

export const devServerRouter = Router();

devServerRouter.get("/status", (_req, res) => {
  res.json(getDevServerStatus());
});

devServerRouter.post("/start", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const broadcast = (msg: object) => {
      const wss = req.app.locals.wss;
      if (wss) {
        const data = JSON.stringify(msg);
        for (const client of wss.clients) {
          if (client.readyState === 1) {
            client.send(data);
          }
        }
      }
    };
    const url = await startDevServer(projectPath, broadcast);
    res.json({ success: true, url });
  } catch (err: any) {
    // Structured failures are returned as 200 so the client can render them
    // as a normal app state instead of a thrown error. Generic failures still
    // surface as 500 with a string message.
    if (err instanceof DevServerStartFailure) {
      res.json({ success: false, error: err.cause });
      return;
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

devServerRouter.post("/stop", (_req, res) => {
  stopDevServer();
  res.json({ success: true });
});

/**
 * Proxy that serves the Astro page HTML with our overlay script injected.
 * Only the initial HTML page goes through the proxy — all sub-resources
 * (CSS, JS, WebSocket) load directly from the Astro dev server.
 *
 * The iframe src points to /preview/ which returns the Astro page HTML.
 * We inject an inline script that loads our overlay from the backend.
 * A <base> tag ensures all relative URLs resolve to the Astro dev server,
 * and since module imports in @vite/client use absolute paths starting with /,
 * we DON'T use <base> (it would break them). Instead, the inline script
 * that we inject fetches our overlay.js dynamically.
 */
export function startDevServerProxy(
  app: Express,
  _projectPath: string,
  _broadcast: (message: object) => void
) {
  // Serve the injected.js with proper CORS for cross-origin iframe
  app.use("/api/injected", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  app.use("/preview", (req: Request, res: Response) => {
    const { url: devUrl } = getDevServerStatus();
    if (!devUrl) {
      res.status(502).send("Dev server not running.");
      return;
    }

    const targetUrl = new URL(devUrl);
    const targetPath = req.url || "/";

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value[0];
    }
    headers["host"] = targetUrl.host;

    const proxyReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetPath,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        const contentType = proxyRes.headers["content-type"] || "";
        const isHtml = contentType.includes("text/html");

        // For non-HTML (CSS, JS, assets): redirect to the Astro dev server.
        // This ensures Vite module resolution works correctly.
        if (!isHtml) {
          res.redirect(302, `${devUrl}${targetPath}`);
          return;
        }

        // HTML: buffer, inject, send
        const skipHeaders = new Set(["content-length", "content-encoding", "transfer-encoding"]);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (!skipHeaders.has(key.toLowerCase()) && value !== undefined) {
            res.setHeader(key, value);
          }
        }
        res.statusCode = proxyRes.statusCode || 200;

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf-8");

          // Remove Astro dev toolbar
          html = html.replace(/<script[^>]*dev-toolbar[^>]*>[\s\S]*?<\/script>/gi, "");
          html = html.replace(/<script[^>]*astro[^"]*toolbar[^>]*>[\s\S]*?<\/script>/gi, "");

          // Add <base> pointing at the Astro dev server.
          // This makes ALL resource URLs (CSS, JS imports, images) resolve to the
          // Astro dev server. Vite client, HMR WebSocket, CSS modules — everything
          // works natively because it's the same origin as the dev server.
          html = html.replace("<head>", `<head>\n<base href="${devUrl}/">`);

          // Inject overlay script with absolute URL to our backend (cross-origin)
          const backendOrigin = `${req.protocol}://${req.get("host")}`;
          const injectedScript = `<script src="${backendOrigin}/api/injected/injected.js"></script>`;
          html = html.replace("</body>", `${injectedScript}\n</body>`);

          res.setHeader("content-length", Buffer.byteLength(html));
          res.end(html);
        });
      }
    );

    proxyReq.on("error", (err) => {
      console.error("[Proxy] Error:", err.message);
      res.status(502).send("Dev server not available.");
    });

    req.pipe(proxyReq);
  });
}

// No-op — WebSocket proxy not needed with <base> approach
export function setupPreviewWebSocketProxy(_server: HttpServer) {}
