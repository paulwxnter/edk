import { agentPrompt } from "~/lib/agents";

export function loader() {
  return new Response(agentPrompt(), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
