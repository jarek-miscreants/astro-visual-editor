import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { requireEditorOrigin } from "./require-editor-origin.js";

let server: Server;
let baseUrl: string;
let originalEditorUrl: string | undefined;

beforeEach(async () => {
  originalEditorUrl = process.env.TVE_EDITOR_URL;
  process.env.TVE_EDITOR_URL = "http://localhost:3005";

  const app = express();
  app.post("/guarded", requireEditorOrigin, (_req, res) => {
    res.json({ ok: true });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (originalEditorUrl === undefined) delete process.env.TVE_EDITOR_URL;
  else process.env.TVE_EDITOR_URL = originalEditorUrl;
  await new Promise<void>((r) => server.close(() => r()));
});

describe("requireEditorOrigin", () => {
  it("allows a request with no Origin header (non-browser / navigation)", async () => {
    const res = await fetch(`${baseUrl}/guarded`, { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("allows the configured editor origin", async () => {
    const res = await fetch(`${baseUrl}/guarded`, {
      method: "POST",
      headers: { Origin: "http://localhost:3005" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a drive-by cross-origin request with 403", async () => {
    const res = await fetch(`${baseUrl}/guarded`, {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("forbidden-origin");
  });
});
