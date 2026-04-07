import { Router } from "express";
import { applyMutation } from "../services/file-writer.js";
import { resolveProjectPath, PathTraversalError } from "../lib/path-guard.js";
import type { Mutation } from "@tve/shared";

export const mutationsRouter = Router();

const VALID_MUTATION_TYPES = new Set([
  "update-classes", "update-text", "update-attribute",
  "add-element", "remove-element", "move-element",
  "duplicate-element", "wrap-element",
]);

mutationsRouter.post("/*filePath", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string;
    const raw = (req.params as any).filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : String(raw);
    const fullPath = resolveProjectPath(projectPath, filePath);

    const mutation: Mutation = req.body;
    console.log(`[Mutation] ${mutation?.type} on ${filePath}`, mutation);

    if (!mutation || !mutation.type || !VALID_MUTATION_TYPES.has(mutation.type)) {
      res.status(400).json({ error: `Invalid mutation type: ${mutation?.type}` });
      return;
    }

    // Validate required fields per mutation type
    if ("nodeId" in mutation && typeof mutation.nodeId !== "string") {
      res.status(400).json({ error: "nodeId must be a string" });
      return;
    }

    const result = await applyMutation(fullPath, mutation);

    if (result.success) {
      console.log(`[Mutation] OK ${mutation.type}`);
      res.json({ success: true, ast: result.ast });
    } else {
      console.log(`[Mutation] FAIL ${mutation.type}: ${result.error}`);
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err: any) {
    if (err instanceof PathTraversalError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err.message });
  }
});
