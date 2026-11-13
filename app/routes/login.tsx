import { redirect } from "react-router";
import type { Route } from "./+types/login";
import { SiteHeader } from "~/components/chrome";
import { Contours } from "~/components/brand";
import AuthForm from "~/components/AuthForm";
import { getSessionUser } from "../../server/auth";

export const meta = () => [{ title: "Log in · EDK" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSessionUser(context.cloudflare.env.DB, request)) throw redirect("/console");
  return null;
}

export default function Page() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="auth">
        <div className="hero-bg" aria-hidden="true"><Contours seed={11} /></div>
        <AuthForm mode="login" />
      </main>
    </div>
  );
}
