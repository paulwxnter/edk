import { useEffect, useRef, useState } from "react";
import { AGENT_TARGETS, agentPrompt, INSTALL, type AgentTarget } from "~/lib/agents";

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>
);

export function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text: string) => {
      if (await copyText(text)) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    },
  };
}

export function CodeBlock({ code, label = "", copy = true }: { code: string; label?: string; copy?: boolean }) {
  const { copied, copy: doCopy } = useCopy();
  return (
    <div className="code">
      {label || copy ? (
        <div className="code-label">
          <span>{label}</span>
          {copy ? <button type="button" onClick={() => doCopy(code)}>{copied ? "Copied" : "Copy"}</button> : null}
        </div>
      ) : null}
      <pre>{code}</pre>
    </div>
  );
}

export function InstallSwitcher() {
  const tabs = [
    ["SDK", INSTALL.sdk],
    ["MCP", INSTALL.mcp],
    ["CLI", INSTALL.cli],
  ] as const;
  const [active, setActive] = useState(0);
  const { copied, copy } = useCopy();
  return (
    <div className="install">
      <div className="install-tabs" role="tablist">
        {tabs.map(([name], i) => (
          <button key={name} type="button" role="tab" aria-selected={i === active} className={i === active ? "active" : ""} onClick={() => setActive(i)}>{name}</button>
        ))}
      </div>
      <code>{tabs[active][1]}</code>
      <button type="button" className="copy-btn" aria-label="Copy command" onClick={() => copy(tabs[active][1])}>{copied ? <CheckIcon /> : <CopyIcon />}</button>
    </div>
  );
}

export function AgentMark({ id }: { id: AgentTarget | "claude" | "codex" | "cursor" | "gemini" }) {
  const common = { width: 13, height: 13, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  if (id === "chatgpt") return <svg {...common}><path d="M2.5 3.5h11v7.5H7L4 13.5V11H2.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
  if (id === "claude" || id === "claude-code") return <svg {...common}><path d="M8 1v14M1 8h14M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  if (id === "codex") return <svg {...common}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5.5 6.5 7.5 8l-2 1.5M8.5 10h2" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>;
  if (id === "cursor") return <svg {...common}><path d="M8 1 14 4.5v7L8 15 2 11.5v-7Z" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 8 14 4.5M8 8v7M8 8 2 4.5" stroke="currentColor" strokeWidth="1.2" /></svg>;
  return <svg {...common}><path d="M8 1c.6 3.6 3.4 6.4 7 7-3.6.6-6.4 3.4-7 7-.6-3.6-3.4-6.4-7-7 3.6-.6 6.4-3.4 7-7Z" fill="currentColor" /></svg>;
}

/** "Onboard your agent": pick the agent, and the prompt written for it is copied. */
export function AgentChip() {
  const { copied, copy } = useCopy();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="agent-pick" ref={ref}>
      <button type="button" className={`agent-chip${copied ? " is-copied" : ""}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-live="polite">
        <span>{copied ? `Copied. Paste it into ${picked}` : "Onboard your agent to EDK"}</span>
        <span className="agent-chip-marks" aria-hidden="true">
          <AgentMark id="claude" />
          <AgentMark id="codex" />
          <AgentMark id="cursor" />
          <AgentMark id="gemini" />
        </span>
        <span className="agent-chip-icon" aria-hidden="true">{copied ? <CheckIcon /> : <svg viewBox="0 0 24 24" width="14" height="14"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>}</span>
      </button>
      {open ? (
        <div className="agent-menu" role="menu" aria-label="Choose your agent">
          <p>Which agent? Its prompt is copied.</p>
          {AGENT_TARGETS.map((t) => (
            <button key={t.id} type="button" role="menuitem" onClick={() => { copy(agentPrompt(t.id)); setPicked(t.name); setOpen(false); }}>
              <AgentMark id={t.id} />
              <strong>{t.name}</strong>
              <small>{t.kind}</small>
              <CopyIcon />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
