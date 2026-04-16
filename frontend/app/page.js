"use client";

import { useMemo, useState } from "react";
import {
  analyzeAd,
  generatePersonalizedContent,
  renderPersonalizedHtml,
  scrapePage
} from "../lib/api";
import ResultPanel from "../components/ResultPanel";
import DiffTable from "../components/DiffTable";
import InsightsCard from "../components/InsightsCard";

const initialState = {
  adImageUrl: "",
  landingPageUrl: ""
};

export default function HomePage() {
  const [inputs, setInputs] = useState(initialState);
  const [adFile, setAdFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState("personalized");
  const [result, setResult] = useState(null);

  const canSubmit = useMemo(() => {
    return Boolean(inputs.landingPageUrl && (inputs.adImageUrl || adFile));
  }, [inputs, adFile]);

  const runPipeline = async () => {
    setLoading(true);
    setError("");

    try {
      const ad = await analyzeAd({ imageUrl: inputs.adImageUrl || undefined, file: adFile || undefined });
      const scrapedPage = await scrapePage({ url: inputs.landingPageUrl });
      const generated = await generatePersonalizedContent({
        adInsights: ad.insights,
        scrapedPage
      });
      const rendered = await renderPersonalizedHtml({
        originalHtml: scrapedPage.rawHtml,
        modifications: generated.updatedContent
      });

      setResult({
        insights: ad.insights,
        scrapedPage,
        generated,
        finalHtml: rendered.finalHtml,
        renderMeta: rendered.meta
      });
      setViewMode("personalized");
    } catch (err) {
      setError(err.message || "Failed to personalize landing page");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex h-[100dvh] max-w-7xl flex-col overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <header className="animate-riseIn shrink-0 rounded-2xl border border-[var(--line)] bg-white/90 px-4 py-3 shadow-[0_12px_28px_rgba(16,20,34,0.08)] sm:px-5 sm:py-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-flame">AI CRO Studio</p>
        <h1 className="mt-1 font-display text-[clamp(1.75rem,3vw,2.6rem)] font-bold leading-tight text-ink">
          AI Landing Page Personalizer
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-700 sm:text-[15px]">
          Personalize the same landing page based on ad signal. Structure stays intact, copy gets optimized.
        </p>
      </header>

      <section className="mt-3 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] xl:gap-5">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm sm:p-5">
            <label className="text-sm font-semibold">Landing Page URL</label>
            <input
              type="url"
              className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-flame"
              placeholder="https://example.com/landing"
              value={inputs.landingPageUrl}
              onChange={(e) => setInputs((prev) => ({ ...prev, landingPageUrl: e.target.value }))}
            />

            <label className="mt-3 block text-sm font-semibold">Ad Creative URL (optional if uploading file)</label>
            <input
              type="url"
              className="mt-1.5 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-cyan"
              placeholder="https://example.com/ad-image.png"
              value={inputs.adImageUrl}
              onChange={(e) => setInputs((prev) => ({ ...prev, adImageUrl: e.target.value }))}
            />

            <label className="mt-3 block text-sm font-semibold">Upload Ad Creative</label>
            <input type="file" accept="image/*" className="mt-1.5 block w-full text-sm" onChange={(e) => setAdFile(e.target.files?.[0] || null)} />

            <div className="mt-4 flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={!canSubmit || loading}
                onClick={runPipeline}
                className="rounded-xl bg-flame px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Generating..." : "Generate Personalized Page"}
              </button>
              <button
                type="button"
                disabled={!canSubmit || loading}
                onClick={runPipeline}
                className="rounded-xl border border-ink px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>

            {error ? <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            {result?.scrapedPage?.warnings?.length ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-semibold">Scrape warnings</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.scrapedPage.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <InsightsCard insights={result?.insights} />
          <DiffTable modifications={result?.generated?.updatedContent || []} />
        </div>

        <div className="min-h-0 lg:sticky lg:top-0">
          <ResultPanel
            mode={viewMode}
            onModeChange={setViewMode}
            originalHtml={result?.scrapedPage?.rawHtml || "<html><body><p>No page loaded yet.</p></body></html>"}
            personalizedHtml={result?.finalHtml || ""}
            baseHref={result?.scrapedPage?.finalUrl || result?.scrapedPage?.url || inputs.landingPageUrl}
          />
        </div>
      </section>
    </main>
  );
}
