import { chromium } from "playwright";
import axios from "axios";
import * as cheerio from "cheerio";
import { clampText, normalizeWhitespace } from "./utils.js";
import { config } from "./config.js";

const MAX_SECTIONS = 240;

const closeBrowserSafely = async (browser) => {
  if (!browser) return;
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]).catch(() => null);
};

const roleForElement = (el) => {
  const tag = el.tagName?.toLowerCase() || "div";
  const id = (el.attribs?.id || "").toLowerCase();
  const className = (el.attribs?.class || "").toLowerCase();
  const marker = `${id} ${className}`;

  if (tag === "h1" || marker.includes("hero")) return "hero";
  if (["h2", "h3", "h4", "h5", "h6"].includes(tag)) return "heading";
  if (tag === "button" || marker.includes("cta")) return "cta";
  if (tag === "a" && /(cta|btn|button|shop|buy|start|trial|subscribe|get-?started|order)/i.test(marker)) {
    return "cta";
  }
  if (marker.includes("feature") || marker.includes("benefit")) return "feature";
  if (["p", "li", "span", "label", "small", "blockquote", "figcaption", "td", "th"].includes(tag)) return "body";
  return "unknown";
};

const cssEscape = (value) => {
  return String(value || "").replace(/([^a-zA-Z0-9_-])/g, "\\$1");
};

const getNthOfType = ($, el) => {
  const tag = el.tagName?.toLowerCase() || "div";
  const siblings = $(el)
    .parent()
    .children(tag)
    .toArray();
  const index = siblings.findIndex((sibling) => sibling === el);
  return index + 1;
};

const buildSelector = ($, el, index) => {
  const parts = [];
  let current = el;

  while (current?.tagName) {
    const tag = current.tagName.toLowerCase();
    if (tag === "html") break;

    const id = current.attribs?.id;
    if (id) {
      parts.unshift(`${tag}#${cssEscape(id)}`);
      break;
    }

    const nth = getNthOfType($, current);
    parts.unshift(`${tag}:nth-of-type(${nth})`);
    current = current.parent;
  }

  if (parts.length === 0) {
    const fallbackTag = el.tagName?.toLowerCase() || "div";
    return `${fallbackTag}:nth-of-type(${index + 1})`;
  }

  return parts.join(" > ");
};

const extractSectionsInternal = (html, { relaxed = false } = {}) => {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($("title").first().text() || "Untitled Landing Page");
  const roleCounter = new Map();
  const candidates = relaxed
    ? $(
        "h1, h2, h3, h4, h5, h6, p, li, a, button, span, label, small, strong, em, blockquote, figcaption, td, th, [data-testid*='hero'], [class*='hero'], [class*='cta']"
      ).toArray()
    : $(
        "h1, h2, h3, h4, h5, h6, p, li, a, button, span, label, small, strong, em, blockquote, figcaption, td, th, a[role='button'], a[class*='btn'], a[class*='button'], a[class*='cta'], [data-testid*='hero'], [class*='hero'], [class*='cta']"
      ).toArray();

  const sections = candidates
    .map((el, index) => {
      if (!config.rewriteAllText && !relaxed && $(el).closest("header, nav, footer").length > 0) return null;
      if ($(el).closest("script, style, noscript, svg").length > 0) return null;

      const text = normalizeWhitespace($(el).text() || "");
      if (!text) return null;

      const role = roleForElement(el);
      const minBodyLength = config.rewriteAllText ? 2 : relaxed ? 8 : 20;
      if (role === "cta" && text.length < (config.rewriteAllText ? 2 : 4)) return null;
      if (role === "hero" && text.length < (config.rewriteAllText ? 3 : relaxed ? 6 : 8)) return null;
      if (role === "heading" && text.length < (config.rewriteAllText ? 3 : relaxed ? 5 : 6)) return null;
      if ((role === "body" || role === "unknown") && text.length < minBodyLength) return null;

      const selector = buildSelector($, el, index);
      const nextCount = (roleCounter.get(role) || 0) + 1;
      roleCounter.set(role, nextCount);

      return {
        id: `${role}_${nextCount}`,
        selector,
        role,
        originalText: clampText(text, 320),
        currentText: clampText(text, 320)
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SECTIONS);

  return { title, sections };
};

export const extractSections = (html) => {
  return extractSectionsInternal(html, { relaxed: false });
};

export const scrapePage = async (url) => {
  if (process.env.USE_MOCK_SCRAPER === "true") {
    const rawHtml =
      "<html><head><title>Sample Product Landing</title></head><body><h1 class='hero-title'>Ship faster with our growth platform</h1><button class='cta-primary'>Start free trial</button></body></html>";
    return {
      url,
      title: "Sample Product Landing",
      sections: [
        {
          id: "sec_1",
          selector: "h1.hero-title",
          role: "hero",
          originalText: "Ship faster with our growth platform",
          currentText: "Ship faster with our growth platform"
        },
        {
          id: "sec_2",
          selector: "button.cta-primary",
          role: "cta",
          originalText: "Start free trial",
          currentText: "Start free trial"
        }
      ],
      rawHtml
    };
  }

  const warnings = [];
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  let browserHtml = "";
  let browserTitle = "Untitled Landing Page";
  let browserUrl = url;

  let browser = null;
  try {
    await Promise.race([
      (async () => {
        browser = await chromium.launch({
          headless: true,
          args: ["--disable-http2", "--disable-dev-shm-usage"]
        });

        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          ignoreHTTPSErrors: true,
          userAgent
        });

        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.requestTimeoutMs });
          await page.waitForLoadState("load", { timeout: Math.min(10000, config.requestTimeoutMs) }).catch(() => null);
        } catch (error) {
          warnings.push(`Navigation fallback used: ${error.message}`);
        }

        await page.waitForTimeout(1500).catch(() => null);

        try {
          browserHtml = await page.content();
        } catch {
          browserHtml = await page.evaluate(() => document.documentElement.outerHTML);
        }

        browserTitle = (await page.title().catch(() => "")) || "Untitled Landing Page";
        browserUrl = page.url() || url;
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Browser scrape timed out")), config.requestTimeoutMs + 8000);
      })
    ]);
  } catch (error) {
    warnings.push(`Playwright scrape failed, switching to static fallback: ${error.message}`);
  } finally {
    await closeBrowserSafely(browser);
  }

  let finalHtml = browserHtml;
  let finalUrl = browserUrl;
  let extracted = extractSections(browserHtml || "");
  let finalTitle = extracted.title || browserTitle;

  if (!finalHtml.trim() || extracted.sections.length === 0) {
    try {
      const fallbackRes = await axios.get(url, {
        timeout: config.requestTimeoutMs,
        headers: { "User-Agent": userAgent },
        maxRedirects: 5
      });

      const fallbackHtml = String(fallbackRes.data || "");
      if (fallbackHtml.trim()) {
        finalHtml = fallbackHtml;
        finalUrl = fallbackRes.request?.res?.responseUrl || url;
        extracted = extractSections(fallbackHtml);
        finalTitle = extracted.title || finalTitle;
        warnings.push("Used static HTTP fallback parsing because browser-rendered page had no extractable sections.");
      }
    } catch (fallbackError) {
      warnings.push(`Static fallback parsing failed: ${fallbackError.message}`);
    }
  }

  if (/login|sign in|signin|account/i.test(`${finalUrl} ${finalTitle}`)) {
    warnings.push("Page appears to be a login or account gate. Scraping may only capture the login screen.");
  }

  if (extracted.sections.length === 0 && finalHtml.trim()) {
    const relaxed = extractSectionsInternal(finalHtml, { relaxed: true });
    if (relaxed.sections.length > 0) {
      extracted = relaxed;
      finalTitle = relaxed.title || finalTitle;
      warnings.push("Used relaxed extraction because strict section filtering returned no usable content.");
    }
  }

  if (extracted.sections.length === 0) {
    warnings.push("No hero/CTA/body sections were detected on the rendered page.");
  }

  return {
    url: finalUrl || url,
    title: finalTitle,
    sections: extracted.sections,
    rawHtml: finalHtml || "<html><body><p>Unable to extract page HTML.</p></body></html>",
    warnings,
    finalUrl: finalUrl || url
  };
};
