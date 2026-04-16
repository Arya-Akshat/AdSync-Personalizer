import { z } from "zod";

export const analyzeAdSchema = z
  .object({
    imageUrl: z.string().url().optional()
  })
  .optional();

export const scrapePageSchema = z.object({
  url: z.string().url()
});

export const pageSectionSchema = z.object({
  id: z.string(),
  selector: z.string(),
  role: z.enum(["hero", "heading", "cta", "feature", "body", "unknown"]),
  originalText: z.string(),
  currentText: z.string()
});

export const adInsightsSchema = z.object({
  targetAudience: z.string(),
  tone: z.string(),
  valueProposition: z.string(),
  keywords: z.array(z.string()).max(12),
  confidence: z.number().min(0).max(1),
  notes: z.string().optional()
});

export const scrapedPageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  sections: z.array(pageSectionSchema),
  rawHtml: z.string(),
  warnings: z.array(z.string()).optional(),
  finalUrl: z.string().url().optional()
});

export const generateSchema = z.object({
  adInsights: adInsightsSchema,
  scrapedPage: scrapedPageSchema
});

export const modificationSchema = z.object({
  sectionId: z.string(),
  selector: z.string(),
  originalText: z.string(),
  updatedText: z.string(),
  reason: z.string()
});

export const generatedOutputSchema = z.object({
  updatedContent: z.array(modificationSchema),
  patchInstructions: z.array(z.string()),
  warnings: z.array(z.string())
});

export const renderSchema = z.object({
  originalHtml: z.string().min(1),
  modifications: z.array(modificationSchema)
});
