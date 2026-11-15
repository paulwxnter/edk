import { useState } from "react";
import { Link } from "react-router";
import { SiteLayout } from "~/components/chrome";
import { AgentChip, AgentMark, CodeBlock } from "~/components/copy";
import AsciiArt from "~/ascii/AsciiArt";
import { AGENT_TARGETS, agentPrompt, agentSetups, INSTALL, rulesSnippet, type AgentTarget } from "~/lib/agents";
import { FREE_CU } from "~/lib/pricing";

export const meta = () => [
  { title: "Connect your agent · EDK" },
  { name: "description", content: "Connect Claude Code, Codex, Cursor or Gemini CLI to EDK with one prompt or a few lines of MCP config." },
];

export default function Agents() {
  const [target, setTarget] = useState<AgentTarget>("claude-code");
  return (
    <SiteLayout>
      <section className="page-hero art-host" style={{ position: "relative" }}>
        <div className="art-layer" style={{ left: "55%" }}><AsciiArt art={[{ scene: "birds", x: 0.5, y: 0.45, size: 0.5 }]} /></div>
        <h1>Connect your agent</h1>
        <p>Give Claude, Codex, Cursor, Gemini or ChatGPT a compass. Pick your agent and paste its prompt, or add the MCP server yourself.</p>
        <div style={{ marginTop: "1.5rem", position: "relative" }}><AgentChip /></div>
      </section>
      <div className="docs">
        <nav className="docs-toc" aria-label="On this page">
          <span className="label">Setup</span>
          <a href="#signup">1. Sign up</a>
          <a href="#prompt">2. The prompt</a>
          {agentSetups.map((s) => <a key={s.id} href={`#${s.id}`}>{s.name}</a>)}
          <a href="#other">Anything else</a>
          <a href="#rules">Project rules</a>
        </nav>
        <article className="prose">
          <h2 id="signup">1. Sign up and make a key</h2>
          <ol>
            <li><Link to="/sign-up">Create an account</Link> ({FREE_CU} free CU every month).</li>
            <li>In <Link to="/console/keys">API Keys</Link>, create a secret key.</li>
            <li>Set it in your shell as <code>EDK_API_KEY</code>. Don't paste it into a chat.</li>
          </ol>

          <h2 id="prompt">2. Paste the prompt</h2>
          <p>Each agent sets up differently, so each has its own prompt. Pick yours:</p>
          <div className="tabs" role="tablist" style={{ marginBottom: "1rem" }}>
            {AGENT_TARGETS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={target === t.id} className={target === t.id ? "active" : ""} onClick={() => setTarget(t.id)}>{t.name}</button>
            ))}
          </div>
          <CodeBlock label={`agents.md?for=${target}`} code={agentPrompt(target)} />
          <p>Agents can fetch it themselves from <a href={`/agents.md?for=${target}`}>edk.earth/agents.md?for={target}</a>.</p>

          <h2>Or connect by hand</h2>
          <p>Every client runs the same MCP server: <code>{INSTALL.mcp}</code> with <code>EDK_API_KEY</code> set.</p>
          {agentSetups.map((s) => (
            <section key={s.id} className="agent-setup" aria-labelledby={s.id}>
              <h3 id={s.id}><AgentMark id={s.id as any} /> {s.name}</h3>
              {s.command ? <CodeBlock label="shell" code={s.command} /> : null}
              {s.file ? <CodeBlock label={s.file} code={s.config ?? ""} /> : null}
              {s.note ? <p>{s.note}</p> : null}
            </section>
          ))}

          <h3 id="other">Anything else</h3>
          <p>No MCP? Use the CLI or call the API directly.</p>
          <CodeBlock label="shell" code={`${INSTALL.cli}\nedk login\nedk search "parks with playgrounds in Austin" --limit 5`} />

          <h2 id="rules">Project rules</h2>
          <p>Add this to <code>CLAUDE.md</code>, <code>AGENTS.md</code>, <code>GEMINI.md</code> or <code>.cursor/rules</code> so later sessions know where physical-world questions go:</p>
          <CodeBlock label="markdown" code={rulesSnippet} />
        </article>
      </div>
    </SiteLayout>
  );
}
