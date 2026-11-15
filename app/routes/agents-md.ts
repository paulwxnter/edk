import { agentPrompt, isAgentTarget } from "~/lib/agents";

// /agents.md is the prompt that works anywhere; /agents.md?for=codex is the one for a single platform.
export function loader({ request }: { request: Request }) {
  const target = new URL(request.url).searchParams.get("for");
  return new Response(agentPrompt(isAgentTarget(target) ? target : null), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
