"use client";

export default function InsightsCard({ insights }) {
  if (!insights) return null;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5">
      <h3 className="font-display text-lg font-semibold">Ad Insights</h3>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="font-semibold">Target Audience</dt>
          <dd className="text-slate-700">{insights.targetAudience}</dd>
        </div>
        <div>
          <dt className="font-semibold">Tone</dt>
          <dd className="text-slate-700">{insights.tone}</dd>
        </div>
        <div>
          <dt className="font-semibold">Value Proposition</dt>
          <dd className="text-slate-700">{insights.valueProposition}</dd>
        </div>
        <div>
          <dt className="font-semibold">Keywords</dt>
          <dd className="text-slate-700">{(insights.keywords || []).join(", ")}</dd>
        </div>
      </dl>
    </section>
  );
}
