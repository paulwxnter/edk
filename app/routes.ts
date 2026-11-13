import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("r/:id", "routes/embed-result.tsx"),
  route("atlas", "routes/atlas.tsx"),
  route("docs", "routes/docs.tsx"),
  route("agents", "routes/agents.tsx"),
  route("agents.md", "routes/agents-md.ts"),
  route("llms.txt", "routes/llms-txt.ts"),
  route("brand", "routes/brand.tsx"),
  route("login", "routes/login.tsx"),
  route("sign-up", "routes/sign-up.tsx"),
  layout("routes/console/layout.tsx", [
    route("console", "routes/console/playground.tsx"),
    route("console/atlas", "routes/console/atlas.tsx"),
    route("console/keys", "routes/console/keys.tsx"),
    route("console/account", "routes/console/account.tsx"),
    route("console/billing", "routes/console/billing.tsx"),
  ]),
] satisfies RouteConfig;
