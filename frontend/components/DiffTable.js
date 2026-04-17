"use client";

const formatDomLabel = (selector) => {
  if (!selector) return "Unknown element";

  const last = selector.split(" > ").at(-1) || selector;
  const tag = last.match(/^([a-z0-9-]+)/i)?.[1] || "element";
  const id = last.match(/#([a-zA-Z0-9_-]+)/)?.[1];
  const cls = last.match(/\.([a-zA-Z0-9_-]+)/)?.[1];

  if (id) return `${tag}#${id}`;
  if (cls) return `${tag}.${cls}`;
  return tag;
};

export default function DiffTable({ modifications = [] }) {
  if (modifications.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <h3 className="font-display text-lg font-semibold">Text Diff</h3>
        <p className="mt-2 text-sm text-slate-600">No modifications were applied yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <h3 className="font-display text-lg font-semibold">Text Diff</h3>
      <p className="mt-1 text-sm text-slate-600">Showing the DOM element, the original copy, and the rewritten copy.</p>
      <div className="mt-4 space-y-3">
        {modifications.map((mod) => (
          <article key={`${mod.sectionId}-${mod.selector}`} className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-flame">DOM Element</p>
                <p className="mt-1 text-sm font-semibold text-ink">{formatDomLabel(mod.selector)}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{mod.selector}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                {mod.reason?.replace(/ \(de-duplicated for section specificity\)$/, "")}
              </span>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Before</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{mod.originalText}</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">After</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-950">{mod.updatedText}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
