import * as cheerio from "cheerio";
import { normalizeWhitespace } from "./utils.js";

const TEXT_ONLY_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "span", "strong", "em", "li"]);

const isSafeText = (value) => {
  if (typeof value !== "string") return false;
  if (value.includes("<") || value.includes(">")) return false;
  return value.trim().length > 0;
};

export const applyModificationsToHtml = (originalHtml, modifications) => {
  const $ = cheerio.load(originalHtml);
  const applied = [];
  const skipped = [];

  for (const mod of modifications) {
    const nextText = normalizeWhitespace(mod.updatedText || "");
    if (!isSafeText(nextText)) {
      skipped.push({ ...mod, reason: "Unsafe or empty updated text" });
      continue;
    }

    const target = $(mod.selector).first();
    if (!target || target.length === 0) {
      skipped.push({ ...mod, reason: "Selector not found" });
      continue;
    }

    const tagName = target.get(0)?.tagName?.toLowerCase() || "div";
    if (!TEXT_ONLY_TAGS.has(tagName)) {
      skipped.push({ ...mod, reason: `Unsupported tag for text replacement: ${tagName}` });
      continue;
    }

    const current = normalizeWhitespace(target.text() || "");
    if (!current) {
      skipped.push({ ...mod, reason: "Current target text is empty" });
      continue;
    }

    target.text(nextText);
    target.attr("data-personalized", "true");
    applied.push({ ...mod, originalText: current, updatedText: nextText });
  }

  return {
    html: $.html(),
    meta: {
      appliedCount: applied.length,
      skippedCount: skipped.length,
      applied,
      skipped
    }
  };
};
