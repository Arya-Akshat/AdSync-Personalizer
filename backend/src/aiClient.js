import OpenAI from "openai";
import axios from "axios";
import { config } from "./config.js";
import { adInsightsSchema, generatedOutputSchema } from "./schemas.js";
import { clampText, normalizeWhitespace, tryParseJson } from "./utils.js";

const openai = config.openAiApiKey ? new OpenAI({ apiKey: config.openAiApiKey }) : null;
const groq = config.groqApiKey
  ? new OpenAI({
      apiKey: config.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1"
    })
  : null;

const hasOpenAI = () => Boolean(openai);
const hasGemini = () => Boolean(config.geminiApiKey);
const hasGroq = () => Boolean(groq);

const geminiRequest = async (payload) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.geminiApiKey}`;
  const response = await axios.post(url, payload, {
    timeout: config.requestTimeoutMs,
    headers: { "Content-Type": "application/json" }
  });
  return response.data;
};

const parseGeminiJson = (data) => {
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("\n")
      .trim() || "{}";

  return tryParseJson(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
};

const deterministicOptions = {
  temperature: 0.1,
  top_p: 0.2
};

const withTimeout = async (promise, ms, label) => {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const getFallbackAdInsights = (hint = "") => {
  const words = hint
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
    .slice(0, 8);

  return {
    targetAudience: "Performance-focused online shoppers",
    tone: "confident and direct",
    valueProposition: "Get faster results with less friction and clearer benefits.",
    keywords: [...new Set(["results", "simple", "trust", ...words])].slice(0, 8),
    confidence: 0.42,
    notes: "Fallback heuristic used because no vision model key was configured."
  };
};

const parseGroqJson = (content) => {
  const text = (content || "").trim();
  if (!text) return null;
  return tryParseJson(text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim());
};

export const analyzeAdCreative = async ({ imageUrl, imageBase64, mimeType, fileName }) => {
  if (config.useMockAi || (!hasOpenAI() && !hasGemini() && !hasGroq())) {
    return getFallbackAdInsights(imageUrl || fileName || "");
  }

  if (hasOpenAI()) {
    const imageInput = imageUrl
      ? { type: "input_image", image_url: imageUrl }
      : {
          type: "input_image",
          image_url: `data:${mimeType || "image/png"};base64,${imageBase64}`
        };

    try {
      const response = await withTimeout(
        openai.responses.create({
          model: "gpt-4.1-mini",
          ...deterministicOptions,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    "Analyze ad creative for CRO alignment. Return strict JSON only with fields: targetAudience, tone, valueProposition, keywords(array), confidence(0-1), notes. Keep short and specific."
                }
              ]
            },
            {
              role: "user",
              content: [
                { type: "input_text", text: "Extract signal from this ad creative." },
                imageInput
              ]
            }
          ]
        }),
        Math.min(config.requestTimeoutMs, 20000),
        "OpenAI ad analysis"
      );

      const raw = response.output_text || "{}";
      const parsed = tryParseJson(raw);
      const validated = adInsightsSchema.safeParse(parsed);
      if (validated.success) return validated.data;
    } catch {
      // Fall through to other providers/fallback when upstream is slow or unavailable.
    }
  }

  if (hasGemini()) {
    const parts = [
      {
        text:
          "Analyze ad creative for CRO alignment. Return strict JSON only with fields: targetAudience, tone, valueProposition, keywords(array), confidence(0-1), notes."
      }
    ];

    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || "image/png",
          data: imageBase64
        }
      });
    } else if (imageUrl) {
      parts.push({
        text: `Ad creative URL (text context only): ${imageUrl}`
      });
    }

    const geminiData = await geminiRequest({
      generationConfig: {
        temperature: 0.1,
        topP: 0.2,
        responseMimeType: "application/json"
      },
      contents: [{ role: "user", parts }]
    });

    const parsed = parseGeminiJson(geminiData);
    const validated = adInsightsSchema.safeParse(parsed);
    if (validated.success) return validated.data;
  }

  if (hasGroq()) {
    const hint = [imageUrl || "", fileName || "", mimeType || ""]
      .filter(Boolean)
      .join(" | ");
    try {
      const response = await withTimeout(
        groq.chat.completions.create({
          model: config.groqModel,
          temperature: 0.1,
          top_p: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are analyzing likely ad intent from metadata only. Return strict JSON with keys: targetAudience, tone, valueProposition, keywords(array), confidence(0-1), notes."
            },
            {
              role: "user",
              content: `Ad metadata hint: ${hint || "no hint provided"}`
            }
          ]
        }),
        Math.min(config.requestTimeoutMs, 15000),
        "Groq ad analysis"
      );

      const parsed = parseGroqJson(response.choices?.[0]?.message?.content || "");
      const validated = adInsightsSchema.safeParse(parsed);
      if (validated.success) {
        return {
          ...validated.data,
          notes:
            validated.data.notes ||
            "Groq text model used with metadata-only signal; vision parsing was not available in this provider path."
        };
      }
    } catch {
      // Fall through to heuristic fallback when Groq call times out/fails.
    }
  }

  const fallback = getFallbackAdInsights(imageUrl || fileName || "");
  if (hasGroq()) {
    return {
      ...fallback,
      notes:
        "Groq is configured, but ad insight extraction fell back to heuristic mode because structured JSON parsing failed."
    };
  }
  return fallback;
};

const fallbackGenerate = ({ adInsights, scrapedPage }) => {
  const keywordSet = adInsights.keywords.slice(0, 4).join(", ");
  const updated = scrapedPage.sections
    .filter((s) => ["hero", "heading", "cta"].includes(s.role))
    .slice(0, 8)
    .map((section) => {
      let updatedText = section.currentText;
      if (section.role === "cta") {
        updatedText = clampText(`Start now - ${adInsights.valueProposition}`);
      } else if (section.role === "hero") {
        updatedText = clampText(
          `${section.currentText}. Built for ${adInsights.targetAudience.toLowerCase()} with ${keywordSet}.`
        );
      } else {
        updatedText = clampText(`${section.currentText} | ${adInsights.valueProposition}`);
      }
      return {
        sectionId: section.id,
        selector: section.selector,
        originalText: section.currentText,
        updatedText: normalizeWhitespace(updatedText),
        reason: `Aligned with ad tone: ${adInsights.tone}`
      };
    })
    .filter((m) => m.updatedText && m.updatedText !== m.originalText);

  return {
    updatedContent: updated,
    patchInstructions: updated.map(
      (m) => `Update ${m.selector} text to emphasize ${adInsights.valueProposition}`
    ),
    warnings: ["Fallback generation used because provider output was unavailable or invalid."]
  };
};

export const generatePersonalization = async ({ adInsights, scrapedPage }) => {
  if (config.useMockAi || (!hasOpenAI() && !hasGemini() && !hasGroq())) {
    return fallbackGenerate({ adInsights, scrapedPage });
  }

  if (hasOpenAI()) {
    const prompt = {
      constraints: [
        "Do not remove sections",
        "Do not invent new features",
        "Preserve layout and DOM structure",
        "Only rewrite text content",
        "Avoid hallucinations"
      ],
      adInsights,
      sections: scrapedPage.sections.map((s) => ({
        id: s.id,
        selector: s.selector,
        role: s.role,
        text: s.currentText
      }))
    };

    try {
      const response = await withTimeout(
        openai.responses.create({
          model: "gpt-4.1-mini",
          ...deterministicOptions,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text:
                    "You are a CRO copy editor. Output strict JSON only with keys: updatedContent, patchInstructions, warnings. For updatedContent, include only existing section ids/selectors. Never alter structure."
                }
              ]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: JSON.stringify(prompt) }]
            }
          ]
        }),
        Math.min(config.requestTimeoutMs, 22000),
        "OpenAI personalization"
      );

      const raw = response.output_text || "{}";
      const parsed = tryParseJson(raw);
      const validated = generatedOutputSchema.safeParse(parsed);
      if (validated.success) {
        const safeUpdates = validated.data.updatedContent
          .filter((u) => scrapedPage.sections.some((s) => s.id === u.sectionId && s.selector === u.selector))
          .map((u) => ({ ...u, updatedText: clampText(u.updatedText, 320) }))
          .filter((u) => u.updatedText && u.updatedText !== u.originalText);

        return {
          ...validated.data,
          updatedContent: safeUpdates
        };
      }
    } catch {
      // Fall through to next provider/fallback.
    }
  }

  if (hasGemini()) {
    const prompt = {
      constraints: [
        "Do not remove sections",
        "Do not invent new features",
        "Preserve layout and DOM structure",
        "Only rewrite text content",
        "Avoid hallucinations"
      ],
      adInsights,
      sections: scrapedPage.sections.map((s) => ({
        id: s.id,
        selector: s.selector,
        role: s.role,
        text: s.currentText
      })),
      outputFormat: {
        updatedContent: [
          {
            sectionId: "string",
            selector: "string",
            originalText: "string",
            updatedText: "string",
            reason: "string"
          }
        ],
        patchInstructions: ["string"],
        warnings: ["string"]
      }
    };

    const geminiData = await geminiRequest({
      generationConfig: {
        temperature: 0.1,
        topP: 0.2,
        responseMimeType: "application/json"
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "You are a CRO copy editor. Return strict JSON matching outputFormat. Only update text for existing sections."
            },
            { text: JSON.stringify(prompt) }
          ]
        }
      ]
    });

    const parsed = parseGeminiJson(geminiData);
    const validated = generatedOutputSchema.safeParse(parsed);
    if (validated.success) {
      const safeUpdates = validated.data.updatedContent
        .filter((u) => scrapedPage.sections.some((s) => s.id === u.sectionId && s.selector === u.selector))
        .map((u) => ({ ...u, updatedText: clampText(u.updatedText, 320) }))
        .filter((u) => u.updatedText && u.updatedText !== u.originalText);

      return {
        ...validated.data,
        updatedContent: safeUpdates
      };
    }
  }

  if (hasGroq()) {
    const prompt = {
      constraints: [
        "Do not remove sections",
        "Do not invent new features",
        "Preserve layout and DOM structure",
        "Only rewrite text content",
        "Avoid hallucinations"
      ],
      adInsights,
      sections: scrapedPage.sections.map((s) => ({
        id: s.id,
        selector: s.selector,
        role: s.role,
        text: s.currentText
      })),
      outputFormat: {
        updatedContent: [
          {
            sectionId: "string",
            selector: "string",
            originalText: "string",
            updatedText: "string",
            reason: "string"
          }
        ],
        patchInstructions: ["string"],
        warnings: ["string"]
      }
    };

    try {
      const response = await withTimeout(
        groq.chat.completions.create({
          model: config.groqModel,
          temperature: 0.1,
          top_p: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a CRO copy editor. Return strict JSON matching outputFormat. Only modify text for existing section ids and selectors."
            },
            {
              role: "user",
              content: JSON.stringify(prompt)
            }
          ]
        }),
        Math.min(config.requestTimeoutMs, 20000),
        "Groq personalization"
      );

      const parsed = parseGroqJson(response.choices?.[0]?.message?.content || "");
      const validated = generatedOutputSchema.safeParse(parsed);
      if (validated.success) {
        const safeUpdates = validated.data.updatedContent
          .filter((u) => scrapedPage.sections.some((s) => s.id === u.sectionId && s.selector === u.selector))
          .map((u) => ({ ...u, updatedText: clampText(u.updatedText, 320) }))
          .filter((u) => u.updatedText && u.updatedText !== u.originalText);

        return {
          ...validated.data,
          updatedContent: safeUpdates
        };
      }
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  return fallbackGenerate({ adInsights, scrapedPage });
};
