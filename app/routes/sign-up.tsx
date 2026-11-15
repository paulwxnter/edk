import { redirect } from "react-router";
import type { Route } from "./+types/sign-up";
import { SiteHeader } from "~/components/chrome";
import AuthForm from "~/components/AuthForm";
import { getSessionUser } from "../../server/auth";
import { turnstileSiteKey } from "../../server/guard";

export const meta = () => [{ title: "Sign up · EDK" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSessionUser(context.cloudflare.env.DB, request)) throw redirect("/console");
  return { turnstileSiteKey: turnstileSiteKey() };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  return (
    <div className="site">
      <SiteHeader />
      <main className="auth">
        <div className="hero-bg" aria-hidden="true" />
        <AuthForm mode="sign-up" turnstileSiteKey={loaderData.turnstileSiteKey} />
      </main>
    </div>
  );
}
