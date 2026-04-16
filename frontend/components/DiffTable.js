"use client";

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
      <div className="mt-4 space-y-3">
        {modifications.map((mod) => (
          <article key={`${mod.sectionId}-${mod.selector}`} className="rounded-xl border border-[var(--line)] bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{mod.selector}</p>
            <p className="mt-2 text-sm text-slate-600 line-through">{mod.originalText}</p>
            <p className="mt-2 text-sm font-semibold text-ink">{mod.updatedText}</p>
            <p className="mt-2 text-xs text-slate-500">{mod.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
