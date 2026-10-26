import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface AiBundle {
  safety: string;
  decision: {
    level: string;
    confidence: number;
    explanation: string;
    modelName: string;
    modelVersion: string;
    contributing: Array<{ code: string; detail: string }>;
    contradicting: Array<{ code: string; detail: string }>;
  };
  shadow: { level: string; modelVersion: string; applied: boolean; note: string };
  summary: { summary: string; changes: string; risks: string };
  recommendations: Array<{ id: string; action: string; reason: string; status: string }>;
  search: Array<{ id: string; kind: string; label: string; confidence: number }>;
  evidence: { analysed: boolean; chunks: number; note: string };
  reviews: Array<{ id: string; status: string; note: string; createdAt: string }>;
}

export function AiPanel({ id, token, canDecide }: { id: string; token: string | null; canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bundle = useQuery({
    queryKey: ["ai", id],
    queryFn: () => api<AiBundle>(`/api/v1/incidents/${id}/ai`, token),
    refetchInterval: 15_000,
  });
  const row = bundle.data;

  async function ask(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<{ answer: string }>(`/api/v1/incidents/${id}/ai/query`, token, {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setAnswer(result.answer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The question could not be answered.");
    }
  }

  async function decide(recommendationId: string, status: "ACCEPTED" | "REJECTED") {
    setError(null);
    try {
      await api(`/api/v1/incidents/${id}/ai/recommendations/${recommendationId}`, token, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await queryClient.invalidateQueries({ queryKey: ["ai", id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recommendation was not updated.");
    }
  }

  if (bundle.isError) return <p className="mt-4 text-sos">Intelligence could not be loaded.</p>;
  if (!row) return <p className="mt-4 text-sm text-slate-300">Loading intelligence.</p>;

  return (
    <section className="mt-4 space-y-4" aria-label="AI intelligence">
      <p className="rounded-xl border border-line bg-panel p-4 text-sm text-slate-200">{row.safety}</p>
      <article className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-xl font-semibold">
          {row.decision.level} <span className="text-base font-normal text-slate-300">confidence {Math.round(row.decision.confidence * 100)}%</span>
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          {row.decision.modelName} {row.decision.modelVersion}
        </p>
        <p className="mt-3 text-sm">{row.decision.explanation}</p>
        <h3 className="mt-4 text-sm font-semibold">Contributing signals</h3>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-300">
          {row.decision.contributing.map((signal) => (
            <li key={signal.code}>{signal.detail}</li>
          ))}
        </ul>
        <h3 className="mt-4 text-sm font-semibold">Signals that argue the other way</h3>
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-300">
          {row.decision.contradicting.length === 0 ? <li>None stored.</li> : null}
          {row.decision.contradicting.map((signal) => (
            <li key={signal.code}>{signal.detail}</li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          Shadow {row.shadow.modelVersion} would say {row.shadow.level}. {row.shadow.note}
        </p>
      </article>
      <article className="rounded-2xl border border-line bg-panel p-4 text-sm">
        <h2 className="text-lg font-semibold">Situation</h2>
        <p className="mt-2">{row.summary.summary}</p>
        <p className="mt-2 text-slate-300">{row.summary.changes}</p>
        <p className="mt-2 text-slate-300">{row.summary.risks}</p>
      </article>
      <article className="rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-lg font-semibold">Recommendations</h2>
        <ul className="mt-3 space-y-3 text-sm">
          {row.recommendations.length === 0 ? <li>None pending.</li> : null}
          {row.recommendations.map((item) => (
            <li key={item.id} className="rounded-xl border border-line p-3">
              <p className="font-semibold">
                {item.action} · {item.status}
              </p>
              <p className="mt-1 text-slate-300">{item.reason}</p>
              {canDecide && item.status === "PENDING" ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded-lg border border-line px-3 py-1" onClick={() => void decide(item.id, "ACCEPTED")}>
                    Accept
                  </button>
                  <button type="button" className="rounded-lg border border-line px-3 py-1" onClick={() => void decide(item.id, "REJECTED")}>
                    Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">Accepting a recommendation records the operator decision. It does not dispatch or contact emergency services.</p>
      </article>
      <article className="rounded-2xl border border-line bg-panel p-4 text-sm">
        <h2 className="text-lg font-semibold">Search areas</h2>
        <ul className="mt-2 list-disc pl-5 text-slate-300">
          {row.search.length === 0 ? <li>No confirmed fix, so no search area was drawn.</li> : null}
          {row.search.map((area) => (
            <li key={area.id}>
              {area.kind}: {area.label}
            </li>
          ))}
        </ul>
      </article>
      <article className="rounded-2xl border border-line bg-panel p-4 text-sm">
        <h2 className="text-lg font-semibold">Evidence</h2>
        <p className="mt-2 text-slate-300">
          {row.evidence.chunks} chunk(s). {row.evidence.note}
        </p>
      </article>
      <form className="rounded-2xl border border-line bg-panel p-4" onSubmit={ask}>
        <h2 className="text-lg font-semibold">Ask from the incident record</h2>
        <label className="mt-3 block text-sm" htmlFor="ai-question">
          Question
        </label>
        <textarea
          id="ai-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm"
          placeholder="Where was the last confirmed location?"
        />
        <button type="submit" className="mt-2 rounded-lg border border-line px-3 py-2 text-sm">
          Ask
        </button>
        {answer ? <p className="mt-3 text-sm">{answer}</p> : null}
        {error ? <p className="mt-2 text-sm text-sos">{error}</p> : null}
      </form>
    </section>
  );
}
