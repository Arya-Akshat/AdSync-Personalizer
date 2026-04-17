import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { config } from "./config.js";
import {
  analyzeAdSchema,
  generatedOutputSchema,
  generateSchema,
  renderSchema,
  scrapePageSchema,
  scrapedPageSchema
} from "./schemas.js";
import { analyzeAdCreative, generatePersonalization } from "./aiClient.js";
import { scrapePage } from "./scraper.js";
import { applyModificationsToHtml } from "./render.js";
import { saveRun, getLatestRun } from "./storage.js";

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

export const createApp = () => {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(
    cors({
      origin: config.allowedOrigins,
      credentials: false
    })
  );

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 80
    })
  );

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      message: "Troopod backend is running",
      health: "/health"
    });
  });

  app.get("/health", (_req, res) => {
    const visionProvider = config.geminiApiKey ? "gemini" : "fallback";
    const textProvider = config.groqApiKey ? "groq" : config.openAiApiKey ? "openai" : "fallback";
    res.json({
      ok: true,
      provider: `${visionProvider}+${textProvider}`,
      visionProvider,
      textProvider,
      geminiCallsEnabled: Boolean(config.geminiApiKey)
    });
  });

  app.post("/analyze-ad", upload.single("image"), async (req, res) => {
    try {
      const parsedBody = analyzeAdSchema.safeParse(req.body);
      if (!parsedBody.success) return res.status(400).json({ error: "Invalid analyze-ad payload" });

      const imageUrl = parsedBody.data?.imageUrl;
      const file = req.file;
      if (!imageUrl && !file) return res.status(400).json({ error: "Provide image upload or imageUrl" });

      const insights = await analyzeAdCreative({
        imageUrl,
        imageBase64: file ? file.buffer.toString("base64") : null,
        mimeType: file?.mimetype,
        fileName: file?.originalname
      });

      res.json({ insights });
    } catch (error) {
      res.status(500).json({ error: "Ad analysis failed", details: error.message });
    }
  });

  app.post("/scrape-page", async (req, res) => {
    try {
      const parsed = scrapePageSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid URL" });

      const result = await scrapePage(parsed.data.url);
      const validated = scrapedPageSchema.safeParse(result);
      if (!validated.success) {
        return res.status(500).json({ error: "Scraped output did not match schema" });
      }

      res.json(validated.data);
    } catch (error) {
      res.status(500).json({ error: "Scrape failed", details: error.message });
    }
  });

  app.post("/generate", async (req, res) => {
    try {
      const parsed = generateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid generation payload" });

      const generated = await generatePersonalization(parsed.data);
      const validated = generatedOutputSchema.safeParse(generated);
      if (!validated.success) {
        return res.status(500).json({ error: "Generated output did not match schema" });
      }

      res.json(validated.data);
    } catch (error) {
      res.status(500).json({ error: "Generation failed", details: error.message });
    }
  });

  app.post("/render", async (req, res) => {
    try {
      const parsed = renderSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid render payload" });

      const transformed = applyModificationsToHtml(parsed.data.originalHtml, parsed.data.modifications);
      const finalHtml = transformed.meta.appliedCount > 0 ? transformed.html : parsed.data.originalHtml;

      saveRun({
        modifications: parsed.data.modifications,
        meta: transformed.meta
      });

      res.json({ finalHtml, meta: transformed.meta, fallbackUsed: transformed.meta.appliedCount === 0 });
    } catch (error) {
      res.status(500).json({ error: "Render failed", details: error.message });
    }
  });

  app.get("/latest-run", (_req, res) => {
    res.json({ latestRun: getLatestRun() });
  });

  return app;
};
