import { chromium } from "playwright";
import axios from "axios";
import * as cheerio from "cheerio";
import { clampText, normalizeWhitespace } from "./utils.js";
import { config } from "./config.js";

const MAX_SECTIONS = 40;

const roleForSelector = (selector) => {
  if (selector.startsWith("h1") || selector.includes("hero")) return "hero";
  if (selector.startsWith("h2") || selector.startsWith("h3")) return "heading";
  if (selector.startsWith("a") || selector.startsWith("button")) return "cta";
  if (selector.includes("feature") || selector.includes("benefit")) return "feature";
  if (selector.startsWith("p")) return "body";
  return "unknown";
};

const buildSelector = (el, index) => {
  const tag = el.tagName?.toLowerCase() || "div";
  const id = el.attribs?.id ? `#${el.attribs.id}` : "";
  const cls = el.attribs?.class
    ? `.${el.attribs.class
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .join(".")}`
    : "";
  return `${tag}${id}${cls}` || `${tag}:nth-of-type(${index + 1})`;
};

export const extractSections = (html) => {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($("title").first().text() || "Untitled Landing Page");
  const candidates = $("h1, h2, h3, p, a.btn, a.button, a[role='button'], button, [data-testid*='hero'], [class*='hero'], [class*='cta']").toArray();

  const sections = candidates
    .map((el, index) => {
      const text = normalizeWhitespace($(el).text() || "");
      if (!text || text.length < 3) return null;
      const selector = buildSelector(el, index);
      return {
        id: `sec_${index + 1}`,
        selector,
        role: roleForSelector(selector),
        originalText: clampText(text, 320),
        currentText: clampText(text, 320)
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SECTIONS);

  return { title, sections };
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
    if (browser) {
      await browser.close().catch(() => null);
    }
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
