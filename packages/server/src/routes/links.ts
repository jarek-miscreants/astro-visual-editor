import { Router } from "express";
import { getLinkTargets } from "../services/link-targets.js";

export const linksRouter = Router();

linksRouter.get("/targets", async (req, res) => {
  try {
    const projectPath = req.app.locals.projectPath as string | null;
    if (!projectPath) {
      res.json({ targets: [] });
      return;
    }

    const targets = await getLinkTargets(projectPath);
    res.json({ targets });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
