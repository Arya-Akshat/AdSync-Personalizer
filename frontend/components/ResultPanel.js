"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const injectBaseHref = (html, baseHref) => {
  if (!html || !baseHref) return html;
  if (/<base\s+href=/i.test(html)) return html;

  const baseTag = `<base href="${baseHref}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }

  return `<head>${baseTag}</head>${html}`;
};

export default function ResultPanel({ mode, onModeChange, originalHtml, personalizedHtml, baseHref }) {
  const rawDoc = mode === "original" ? originalHtml : personalizedHtml || originalHtml;
  const srcDoc = injectBaseHref(rawDoc, baseHref);
  const frameAreaRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Render pages in a stable virtual viewport and scale down to fit the panel.
  const virtualViewport = useMemo(() => ({ width: 1366, height: 900 }), []);

  useEffect(() => {
    if (!frameAreaRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setContainerSize({ width: rect.width, height: rect.height });
    });

    resizeObserver.observe(frameAreaRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const scale = useMemo(() => {
    const wRatio = containerSize.width / virtualViewport.width;
    const hRatio = containerSize.height / virtualViewport.height;
    const next = Math.min(wRatio || 0, hRatio || 0);
    return Number.isFinite(next) && next > 0 ? Math.min(next, 1) : 1;
  }, [containerSize.height, containerSize.width, virtualViewport.height, virtualViewport.width]);

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_8px_24px_rgba(16,20,34,0.06)]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <h2 className="font-display text-base font-semibold sm:text-lg">Rendered Landing Page</h2>
        <div className="rounded-xl border border-[var(--line)] bg-white p-1">
          <button
            className={`rounded-lg px-3 py-1 text-sm font-semibold ${mode === "original" ? "bg-ink text-white" : "text-ink"}`}
            onClick={() => onModeChange("original")}
            type="button"
          >
            Original
          </button>
          <button
            className={`rounded-lg px-3 py-1 text-sm font-semibold ${mode === "personalized" ? "bg-flame text-white" : "text-ink"}`}
            onClick={() => onModeChange("personalized")}
            type="button"
          >
            Personalized
          </button>
        </div>
      </div>
      <div ref={frameAreaRef} className="min-h-0 flex-1 overflow-hidden rounded-b-2xl bg-slate-100">
        <iframe
          title="landing-preview"
          srcDoc={srcDoc}
          className="border-0 bg-white"
          style={{
            width: `${virtualViewport.width}px`,
            height: `${virtualViewport.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: "top left"
          }}
          sandbox="allow-same-origin allow-popups allow-forms"
        />
      </div>
    </section>
  );
}
