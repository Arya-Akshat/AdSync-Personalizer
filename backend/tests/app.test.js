process.env.USE_MOCK_AI = "true";
process.env.USE_MOCK_SCRAPER = "true";

import request from "supertest";
import { describe, test, expect } from "@jest/globals";
import { createApp } from "../src/app.js";

describe("API endpoints", () => {
  const app = createApp();

  test("GET /health", async () => {
    const res = await request(app).get("/health");
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("POST /analyze-ad with imageUrl", async () => {
    const res = await request(app).post("/analyze-ad").send({ imageUrl: "https://example.com/ad.png" });
    expect(res.statusCode).toBe(200);
    expect(res.body.insights).toHaveProperty("targetAudience");
    expect(Array.isArray(res.body.insights.keywords)).toBe(true);
  });

  test("POST /scrape-page", async () => {
    const res = await request(app).post("/scrape-page").send({ url: "https://example.com" });
    expect(res.statusCode).toBe(200);
    expect(res.body.sections.length).toBeGreaterThan(0);
  });

  test("POST /generate", async () => {
    const payload = {
      adInsights: {
        targetAudience: "Busy founders",
        tone: "clear and urgent",
        valueProposition: "Faster launch and measurable conversion lift",
        keywords: ["conversion", "faster", "trust"],
        confidence: 0.7,
        notes: "mock"
      },
      scrapedPage: {
        url: "https://example.com",
        title: "Sample",
        sections: [
          {
            id: "sec_1",
            selector: "h1.hero-title",
            role: "hero",
            originalText: "Ship faster",
            currentText: "Ship faster"
          },
          {
            id: "sec_2",
            selector: "button.cta-primary",
            role: "cta",
            originalText: "Start",
            currentText: "Start"
          }
        ],
        rawHtml: "<html></html>"
      }
    };

    const res = await request(app).post("/generate").send(payload);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.updatedContent)).toBe(true);
  });

  test("POST /render", async () => {
    const res = await request(app)
      .post("/render")
      .send({
        originalHtml:
          "<html><body><h1 class='hero-title'>Ship faster with our growth platform</h1><button class='cta-primary'>Start free trial</button></body></html>",
        modifications: [
          {
            sectionId: "sec_1",
            selector: "h1.hero-title",
            originalText: "Ship faster with our growth platform",
            updatedText: "Grow revenue faster with conversion-ready messaging",
            reason: "Match ad promise"
          }
        ]
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.finalHtml).toContain("Grow revenue faster");
    expect(res.body.meta.appliedCount).toBe(1);
  });
});
