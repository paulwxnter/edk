import { redirect } from "react-router";
import type { Route } from "./+types/signals-redirect";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return redirect(`/signals${url.pathname.slice("/trends".length)}${url.search}`, 308);
}
