import { useEffect, useState } from "react";
import type { Dataset } from "lib/locate/datasets";

/** Data Source: the published datasets a signal is built from, with publisher, place and licence. */
export default function SignalCitations({ feature, region }: { feature: string; region: string }) {
  const [citations, setCitations] = useState<Dataset[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    const params = new URLSearchParams({ feature, region });
    fetch(`/signals/api/citations?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load citations");
        const result = await response.json() as { citations: Dataset[] };
        if (!controller.signal.aborted) setCitations(result.citations);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [feature, region, retry]);

  if (failed) return <div className="sd-state" role="status"><p>Could not load the sources for this signal.</p><button type="button" className="btn btn-sm" onClick={() => setRetry(retry + 1)}>Try again</button></div>;
  if (!citations) return <div className="sd-state" role="status"><span className="spinner faint" /> Loading sources…</div>;
  if (!citations.length) return <div className="sd-state"><p>No dataset citation is published for this signal and place yet.</p></div>;

  return (
    <ul className="sd-citations">
      {citations.map((citation) => {
        const meta = [
          ["Publisher", citation.publisher],
          ["Coverage", citation.place],
          ["Category", citation.category],
          ["Licence", citation.license],
        ].filter((pair): pair is [string, string] => Boolean(pair[1]));
        return (
          <li key={citation.id}>
            <div className="sd-citation-head">
              <cite>{citation.name}</cite>
              {citation.url && <a className="btn btn-sm" href={citation.url} target="_blank" rel="noreferrer">Open source ↗</a>}
            </div>
            {citation.description && <p>{citation.description}</p>}
            {meta.length > 0 && (
              <dl>
                {meta.map(([label, value]) => (
                  <div key={label}><dt className="label">{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}
