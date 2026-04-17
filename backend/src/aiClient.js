import OpenAI from "openai";
import axios from "axios";
import { ChatGroq } from "@langchain/groq";
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
const langchainGroq = config.groqApiKey
  ? new ChatGroq({
      apiKey: config.groqApiKey,
      model: config.groqModel,
      temperature: 0.2,
      maxRetries: 1
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

const fetchImageAsBase64 = async (imageUrl) => {
  const response = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: config.requestTimeoutMs,
    maxRedirects: 5,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    }
  });

  const contentType = response.headers["content-type"] || "image/png";
  return {
    mimeType: contentType.split(";")[0] || "image/png",
    imageBase64: Buffer.from(response.data).toString("base64")
  };
};

const parseGeminiJson = (data) => {
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
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
    .filter((word) => word.length > 3)
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

const isWeakInsights = (insights) => {
  const target = (insights?.targetAudience || "").toLowerCase().trim();
  const tone = (insights?.tone || "").toLowerCase().trim();
  const value = (insights?.valueProposition || "").toLowerCase().trim();
  const keywords = Array.isArray(insights?.keywords) ? insights.keywords : [];

  const weakTarget = !target || target === "unknown";
  const weakTone = !tone || tone === "neutral";
  const weakValue = !value || value === "unknown";
  const weakKeywords = keywords.length === 0;

  return weakTarget && weakTone && weakValue && weakKeywords;
};

const extractImageMetadataHint = (imageBase64) => {
  if (!imageBase64) return "";
  try {
    const utf = Buffer.from(imageBase64, "base64").toString("utf8");
    const xmpDescription = utf.match(/<dc:description>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i)?.[1] || "";
    const altDescription = utf.match(/<rdf:Alt>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i)?.[1] || "";
    const raw = `${xmpDescription} ${altDescription}`
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();

    if (raw.length >= 10) return raw.slice(0, 500);
    return "";
  } catch {
    return "";
  }
};

const looksLikeCategoryCluster = (text) => {
  const normalized = normalizeWhitespace(text || "");
  if (!normalized) return true;

  // Large menu/category blobs often appear as camel-cased concatenations.
  const camelTransitions = (normalized.match(/[a-z][A-Z]/g) || []).length;
  if (camelTransitions >= 4) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  const noSentencePunctuation = !/[.!?]/.test(normalized);
  if (noSentencePunctuation && words.length >= 10 && normalized.length >= 70) return true;

  return false;
};

const isActionableSection = (section) => {
  if (!section) return false;
  const selector = (section.selector || "").toLowerCase();
  const role = (section.role || "").toLowerCase();
  const text = normalizeWhitespace(section.currentText || section.originalText || "");

  if (!selector || !text) return false;

  if (/(^|\W)(header|nav|footer|menu|breadcrumb|hamburger|sitemap)(\W|$)/i.test(selector)) {
    return false;
  }

  if (["nav", "menu", "footer", "link", "metadata"].includes(role)) return false;
  if (role !== "cta" && text.length < 16) return false;
  if (looksLikeCategoryCluster(text)) return false;

  return true;
};

const getNormalizedTokens = (value) =>
  normalizeWhitespace((value || "").toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);

const hasAdSignalOverlap = (text, adInsights) => {
  const textTokens = new Set(getNormalizedTokens(text));
  if (textTokens.size === 0) return false;

  const adTokens = new Set([
    ...getNormalizedTokens(adInsights?.targetAudience || ""),
    ...getNormalizedTokens(adInsights?.valueProposition || ""),
    ...((adInsights?.keywords || []).flatMap((keyword) => getNormalizedTokens(keyword)))
  ]);

  for (const token of adTokens) {
    if (textTokens.has(token)) return true;
  }

  return false;
};

const isLowValueCommerceText = (text, role) => {
  const normalized = normalizeWhitespace((text || "").toLowerCase());
  if (!normalized) return true;

  if (/\b(sign in|login|register|your account|best experience|returns?|orders?)\b/i.test(normalized)) {
    return true;
  }

  if (/\b(up to\s*\d+%|starting\s*[₹$€£]|deals?|discount|gst|amazon brands?)\b/i.test(normalized)) {
    return true;
  }

  if (role !== "cta" && /(\d+%|[₹$€£]\s*\d+)/.test(normalized)) {
    return true;
  }

  return false;
};

const shouldKeepSectionForPersonalization = (section, adInsights) => {
  if (!isActionableSection(section)) return false;

  const role = (section.role || "").toLowerCase();
  const text = normalizeWhitespace(section.currentText || section.originalText || "");

  if (isLowValueCommerceText(text, role)) return false;
  if (role === "cta") return !/\b(sign in|login|register|account)\b/i.test(text);

  const descriptiveRole = ["hero", "heading", "subheading", "body"].includes(role);
  return descriptiveRole ? hasAdSignalOverlap(text, adInsights) : true;
};

const isAppendOnlyRewrite = (originalText, updatedText, adInsights) => {
  const original = normalizeWhitespace(originalText || "");
  const updated = normalizeWhitespace(updatedText || "");
  if (!original || !updated) return false;

  const lowerUpdated = updated.toLowerCase();
  const lowerOriginal = original.toLowerCase();
  const valueProp = normalizeWhitespace(adInsights?.valueProposition || "").toLowerCase();

  const prefixAppend = lowerUpdated.startsWith(lowerOriginal) && updated.length - original.length <= 110;
  const pipeAppend = /\|\s*[a-z]/i.test(updated) && lowerUpdated.startsWith(lowerOriginal);
  const tailHasValueProp = Boolean(valueProp) && lowerUpdated.includes(valueProp) && lowerUpdated.endsWith(valueProp);

  return prefixAppend || pipeAppend || tailHasValueProp;
};

const isLowDiversityOutput = (updates) => {
  if (!Array.isArray(updates) || updates.length < 3) return false;

  const normalized = updates.map((update) => normalizeWhitespace(update.updatedText || "").toLowerCase());
  const unique = new Set(normalized);
  const diversityRatio = unique.size / normalized.length;

  return diversityRatio < 0.6;
};

const getSectionsForRewrite = (scrapedPage, adInsights) => {
  const base = Array.isArray(scrapedPage?.sections) ? scrapedPage.sections : [];
  const seen = new Set();

  const candidates = base.filter((section) => {
    const text = normalizeWhitespace(section?.currentText || section?.originalText || "");
    if (!text || text.length < 2) return false;
    if (seen.has(section.selector)) return false;
    seen.add(section.selector);
    return true;
  });

  if (config.rewriteAllText) return candidates;
  return candidates.filter((section) => shouldKeepSectionForPersonalization(section, adInsights));
};

const getSectionSpecificPhrase = (text) => {
  const normalized = normalizeWhitespace(text || "");
  if (!normalized) return "everyday pet needs";

  const words = normalized
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);

  if (words.length === 0) return "everyday pet needs";
  return words.slice(0, 3).join(" ").toLowerCase();
};

const inferSectionStyle = (text, role = "unknown") => {
  const normalized = normalizeWhitespace(text || "");
  const lower = normalized.toLowerCase();

  if (!normalized) return "neutral copy";
  if (/^".*"$/.test(normalized) || /\b(i|we)\b.*\b(love|used|using|recommend|tried|bought)\b/i.test(lower)) {
    return "testimonial/review";
  }
  if (/\?\s*$/.test(normalized)) return "question-led";
  if (role === "cta") return "short call-to-action";
  if (role === "heading" || role === "hero") return "headline";
  if (/\b(feature|benefit|ready|responsive|fast|easy)\b/i.test(lower)) return "feature description";
  if (/\bhow to|step|guide|learn|tips\b/i.test(lower)) return "instructional";

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 8) return "short label";
  return "informative paragraph";
};

const getFormatHint = (text) => {
  const normalized = normalizeWhitespace(text || "");
  const sentenceCount = (normalized.match(/[.!?]+/g) || []).length || 1;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasQuestion = /\?/.test(normalized);
  const hasExclamation = /!/.test(normalized);
  const isQuoted = /^".*"$/.test(normalized);

  return {
    sentenceCount,
    wordCount,
    hasQuestion,
    hasExclamation,
    isQuoted
  };
};

const summarizeSiteTone = (sections) => {
  const styles = sections.map((section) => inferSectionStyle(section.currentText || section.originalText || "", section.role));
  const counts = new Map();
  for (const style of styles) counts.set(style, (counts.get(style) || 0) + 1);

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);

  return top.length > 0 ? top.join(", ") : "mixed landing-page copy";
};

const buildUniqueRewrite = (section, adInsights, index) => {
  const audience = (adInsights?.targetAudience || "pet owners").toLowerCase();
  const valueProp = normalizeWhitespace(adInsights?.valueProposition || "better pet choices").toLowerCase();
  const keywords = Array.isArray(adInsights?.keywords) ? adInsights.keywords : [];
  const keyA = (keywords[index % Math.max(1, keywords.length)] || "pet care").toLowerCase();
  const keyB = (keywords[(index + 2) % Math.max(1, keywords.length)] || "dog accessories").toLowerCase();
  const phrase = getSectionSpecificPhrase(section?.currentText || section?.originalText || "");
  const original = normalizeWhitespace(section?.currentText || section?.originalText || "");
  const role = (section?.role || "unknown").toLowerCase();
  const style = inferSectionStyle(original, role);
  const format = getFormatHint(original);

  const maybeQuote = (value) => (format.isQuoted ? `"${value}"` : value);

  if (role === "cta") {
    const variants = [
      `Find ${keyA} picks for ${audience}`,
      `Explore ${phrase} essentials now`,
      `Choose smarter ${keyB} options today`,
      `Get practical ${keyA} gear for dogs`
    ];
    return clampText(variants[index % variants.length]);
  }

  if (style === "testimonial/review") {
    const reviewVariants = [
      `"I found ${keyA} options that genuinely improved daily comfort for my dog."`,
      `"These ${keyB} picks feel practical, reliable, and worth recommending to other dog owners."`,
      `"After trying several products, these ${keyA} essentials worked best for routine pet care."`,
      `"Simple to use and thoughtfully designed, these choices made everyday pet care easier for us."`
    ];
    return clampText(reviewVariants[index % reviewVariants.length]);
  }

  if (style === "question-led") {
    const qVariants = [
      `Looking for ${keyA} options that fit your dog's routine?`,
      `Need ${keyB} choices that balance comfort and durability?`,
      `Want practical pet-care picks built for real daily use?`,
      `Searching for reliable essentials tailored to ${audience}?`
    ];
    return clampText(qVariants[index % qVariants.length]);
  }

  if (role === "heading" || role === "hero") {
    const variants = [
      `Smarter ${phrase} choices for ${audience}`,
      `Comfort-first ${keyA} ideas for dog owners`,
      `Practical ${keyB} solutions for daily pet care`,
      `${valueProp.charAt(0).toUpperCase()}${valueProp.slice(1)} for ${audience}`
    ];
    return clampText(variants[index % variants.length]);
  }

  if (style === "short label") {
    const shortVariants = [
      `Dog-care ready`,
      `Comfort-first pick`,
      `Everyday pet essential`,
      `Trusted for dog owners`
    ];
    return clampText(maybeQuote(shortVariants[index % shortVariants.length]));
  }

  if (style === "feature description") {
    const featureVariants = [
      `Built around ${keyA}, this feature helps ${audience} make faster, smarter choices.`,
      `This section highlights ${keyB} options designed for comfort, reliability, and daily use.`,
      `Focused on ${keyA}, this feature makes product comparison clearer for ${audience}.`,
      `Designed for real-world pet routines, this feature emphasizes practical and durable essentials.`
    ];
    return clampText(maybeQuote(featureVariants[index % featureVariants.length]));
  }

  const variants = [
    `Explore ${valueProp} tailored to ${phrase}, with focus on ${keyA} and ${keyB}.`,
    `Compare options for ${phrase} so ${audience} can choose durable ${keyA} products confidently.`,
    `Built around ${keyB} and everyday ${keyA}, this section highlights practical choices for ${audience}.`,
    `For ${audience}, this area emphasizes ${phrase} with reliable ${keyA} recommendations.`
  ];
  return clampText(variants[index % variants.length]);
};

const enforceUniqueUpdates = (updates, sectionsByKey, adInsights) => {
  const seen = new Map();

  return updates.map((update, index) => {
    const normalized = normalizeWhitespace(update.updatedText || "").toLowerCase();
    const count = seen.get(normalized) || 0;
    seen.set(normalized, count + 1);

    if (!normalized || count === 0) return update;

    const section = sectionsByKey.get(`${update.sectionId}::${update.selector}`);
    const uniqueText = buildUniqueRewrite(section, adInsights, index + count);
    return {
      ...update,
      updatedText: normalizeWhitespace(uniqueText),
      reason: `${update.reason} (de-duplicated for section specificity)`
    };
  });
};

const sanitizeGeneratedUpdates = (updates, sections, adInsights) => {
  const allowedSections = config.rewriteAllText
    ? sections
    : sections.filter((section) => shouldKeepSectionForPersonalization(section, adInsights));
  const allowed = new Map(allowedSections.map((section) => [`${section.id}::${section.selector}`, section]));
  const seenSelectors = new Set();

  const sanitized = updates
    .filter((update) => allowed.has(`${update.sectionId}::${update.selector}`))
    .map((update) => ({
      ...update,
      updatedText: normalizeWhitespace(clampText(update.updatedText, 320))
    }))
    .filter((update) => update.updatedText && update.updatedText !== normalizeWhitespace(update.originalText || ""))
    .filter((update) => (config.rewriteAllText ? true : !isAppendOnlyRewrite(update.originalText, update.updatedText, adInsights)))
    .filter((update) => {
      if (seenSelectors.has(update.selector)) return false;
      seenSelectors.add(update.selector);
      return true;
    });

  return enforceUniqueUpdates(sanitized, allowed, adInsights);
};

export const analyzeAdCreative = async ({ imageUrl, imageBase64, mimeType, fileName }) => {
  const metadataHint = extractImageMetadataHint(imageBase64);

  if (config.useMockAi || (!hasOpenAI() && !hasGemini() && !hasGroq())) {
    return getFallbackAdInsights(imageUrl || fileName || metadataHint || "");
  }

  if (hasGemini()) {
    try {
      const vision = imageBase64
        ? { mimeType: mimeType || "image/png", imageBase64 }
        : imageUrl
          ? await fetchImageAsBase64(imageUrl)
          : null;

      if (vision?.imageBase64) {
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
                    "Analyze this ad creative for CRO alignment. Return strict JSON only with fields: targetAudience, tone, valueProposition, keywords(array), confidence(0-1), notes. Keep it short, concrete, and based on visible content only."
                },
                {
                  inlineData: {
                    mimeType: vision.mimeType || "image/png",
                    data: vision.imageBase64
                  }
                }
              ]
            }
          ]
        });

        const parsed = parseGeminiJson(geminiData);
        const validated = adInsightsSchema.safeParse(parsed);
        if (validated.success) {
          if (isWeakInsights(validated.data)) {
            throw new Error("Gemini returned weak ad insights");
          }
          return {
            ...validated.data,
            notes: validated.data.notes || "Gemini vision model used for ad creative analysis."
          };
        }
      }
    } catch {
      // Fall through to Groq or fallback.
    }
  }

  if (hasGroq()) {
    const hint = [imageUrl || "", fileName || "", mimeType || "", metadataHint || ""]
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
        if (isWeakInsights(validated.data)) {
          throw new Error("Groq returned weak ad insights");
        }
        return {
          ...validated.data,
          notes:
            validated.data.notes ||
            "Groq text model used with metadata-only signal; vision parsing was not available in this provider path."
        };
      }
    } catch {
      // Fall through to OpenAI or fallback.
    }
  }

  if (hasOpenAI()) {
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
                    "Analyze ad creative metadata and return strict JSON only with fields: targetAudience, tone, valueProposition, keywords(array), confidence(0-1), notes."
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Ad metadata hint: ${[imageUrl || "", fileName || "", mimeType || "", metadataHint || ""]
                    .filter(Boolean)
                    .join(" | ") || "no hint provided"}`
                }
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
      if (validated.success) {
        if (isWeakInsights(validated.data)) {
          throw new Error("OpenAI returned weak ad insights");
        }
        return validated.data;
      }
    } catch {
      // Fall through to heuristic fallback.
    }
  }

  const fallback = getFallbackAdInsights(imageUrl || fileName || metadataHint || "");
  return hasGroq()
    ? {
        ...fallback,
        notes:
          "Groq is configured, but ad insight extraction fell back to heuristic mode because structured JSON parsing failed."
      }
    : fallback;
};

const fallbackGenerate = ({ adInsights, scrapedPage }) => {
  const sourceSections = getSectionsForRewrite(scrapedPage, adInsights);

  if (sourceSections.length === 0) {
    return {
      updatedContent: [],
      patchInstructions: [],
      warnings: [
        "No rewriteable content sections were found in the scraped page.",
        "Fallback generation skipped because there was no text to personalize."
      ]
    };
  }

  const updated = sourceSections
    .map((section, index) => ({
      sectionId: section.id,
      selector: section.selector,
      originalText: section.currentText,
      updatedText: normalizeWhitespace(buildUniqueRewrite(section, adInsights, index)),
      reason: `Aligned with ad tone: ${adInsights.tone}`
    }))
    .filter((modification) => modification.updatedText && modification.updatedText !== modification.originalText);

  const sectionsByKey = new Map(sourceSections.map((section) => [`${section.id}::${section.selector}`, section]));
  const deduped = enforceUniqueUpdates(updated, sectionsByKey, adInsights);

  return {
    updatedContent: deduped,
    patchInstructions: deduped.map((modification) => `Update ${modification.selector} text to emphasize ${adInsights.valueProposition}`),
    warnings: ["Fallback generation used because provider output was unavailable or invalid."]
  };
};

const generateWithLangChainGroq = async ({ adInsights, scrapedPage, sectionsForRewrite }) => {
  if (!langchainGroq) return null;

  const payload = {
    adInsights,
    sourceToneProfile: summarizeSiteTone(sectionsForRewrite),
    constraints: [
      "Rewrite every provided section.",
      "Use ad keywords and value proposition throughout the rewritten copy.",
      "For short labels and buttons, still rewrite to ad-aligned wording.",
      "Headings can be 1 sentence, body can be 1-2 short sentences.",
      "Every updatedText must be unique across all sections.",
      "Use section-specific wording based on each section's original text.",
      "Preserve the original writing form and tone per section (review stays review, testimonial stays testimonial, heading stays heading).",
      "Keep sentence length and punctuation style close to each original section unless readability suffers.",
      "Return strict JSON only."
    ],
    sections: sectionsForRewrite.map((section) => ({
      sectionId: section.id,
      selector: section.selector,
      role: section.role,
      styleHint: inferSectionStyle(section.currentText, section.role),
      formatHint: getFormatHint(section.currentText),
      originalText: section.currentText
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

  const systemPrompt =
    "You are a CRO copywriter. Rewrite webpage text to match ad insights while preserving each section's original tone and writing form. If a section is a review/testimonial, rewrite it as a review/testimonial; if it is a heading, keep it as a heading. You must rewrite every section in the input, including short labels and CTA text. Every updatedText must be unique and section-specific. Return strict JSON with keys: updatedContent, patchInstructions, warnings.";

  const rawResponse = await withTimeout(
    langchainGroq.invoke([
      ["system", systemPrompt],
      ["human", JSON.stringify(payload)]
    ]),
    Math.min(config.requestTimeoutMs, 25000),
    "LangChain Groq personalization"
  );

  const parsed = parseGroqJson(rawResponse?.content || "");
  const validated = generatedOutputSchema.safeParse(parsed);
  if (!validated.success) return null;

  return validated.data;
};

export const generatePersonalization = async ({ adInsights, scrapedPage }) => {
  const sectionsForRewrite = getSectionsForRewrite(scrapedPage, adInsights);

  if (sectionsForRewrite.length === 0) {
    return {
      updatedContent: [],
      patchInstructions: [],
      warnings: ["No text sections available for personalization."]
    };
  }

  if (config.useMockAi || (!hasOpenAI() && !hasGemini() && !hasGroq())) {
    return fallbackGenerate({ adInsights, scrapedPage });
  }

  if (hasGroq()) {
    try {
      const lcResult = await generateWithLangChainGroq({ adInsights, scrapedPage, sectionsForRewrite });
      if (lcResult) {
        const safeUpdates = sanitizeGeneratedUpdates(lcResult.updatedContent, sectionsForRewrite, adInsights);
        if (safeUpdates.length > 0 && (config.rewriteAllText || !isLowDiversityOutput(safeUpdates))) {
          return {
            ...lcResult,
            updatedContent: safeUpdates
          };
        }
      }
    } catch {
      // Single-call policy: do not attempt additional provider calls.
    }
  }

  return fallbackGenerate({ adInsights, scrapedPage });
};
