import fs from "fs";

const base = "http://localhost:8080";
const landingUrl =
  "https://accounts.myntra.com/login?cidx=ads_myntra-3af60fb1-d9d4-462d-a52e-bbb9b3175cf3&pageRequested=https%3A%2F%2Fspectrum-advertising-api.myntra.com%2Fapi%2Fuser%2Flogin%2Fmintadvantage%3Fback%3Dhttps%253A%252F%252Fadvertising.myntra.com%252F%253Fstate%253Dmintadvantage-login";

const fetchJsonWithTimeout = async (url, options, timeoutMs, label) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json();
    return { res, data };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const run = async () => {
  const form = new FormData();
  const fileBuffer = fs.readFileSync("This.webp");
  const file = new Blob([fileBuffer], { type: "image/webp" });
  form.append("image", file, "This.webp");

  const { res: analyzeRes, data: analyze } = await fetchJsonWithTimeout(
    `${base}/analyze-ad`,
    { method: "POST", body: form },
    25000,
    "analyze-ad"
  );

  const { res: scrapeRes, data: scrape } = await fetchJsonWithTimeout(
    `${base}/scrape-page`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: landingUrl })
    },
    70000,
    "scrape-page"
  );

  let generateStatus = null;
  let renderStatus = null;
  let generate = null;
  let render = null;

  if (analyzeRes.ok && scrapeRes.ok) {
    const generateResult = await fetchJsonWithTimeout(
      `${base}/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adInsights: analyze.insights, scrapedPage: scrape })
      },
      35000,
      "generate"
    );
    generateStatus = generateResult.res.status;
    generate = generateResult.data;

    if (generateResult.res.ok) {
      const renderResult = await fetchJsonWithTimeout(
        `${base}/render`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ originalHtml: scrape.rawHtml, modifications: generate.updatedContent })
        },
        15000,
        "render"
      );
      renderStatus = renderResult.res.status;
      render = renderResult.data;
    }
  }

  console.log(
    JSON.stringify(
      {
        analyzeStatus: analyzeRes.status,
        scrapeStatus: scrapeRes.status,
        generateStatus,
        renderStatus,
        providerNotes: analyze?.insights?.notes || null,
        scrapeTitle: scrape?.title || null,
        scrapeFinalUrl: scrape?.finalUrl || scrape?.url || null,
        scrapeWarnings: scrape?.warnings || [],
        sectionCount: (scrape?.sections || []).length,
        updateCount: (generate?.updatedContent || []).length,
        renderAppliedCount: render?.meta?.appliedCount || 0,
        renderFallbackUsed: render?.fallbackUsed ?? null
      },
      null,
      2
    )
  );
};

run().catch((err) => {
  console.error(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
});
