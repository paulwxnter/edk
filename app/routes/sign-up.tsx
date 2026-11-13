import { redirect } from "react-router";
import type { Route } from "./+types/sign-up";
import { SiteHeader } from "~/components/chrome";
import { Contours } from "~/components/brand";
import AuthForm from "~/components/AuthForm";
import { getSessionUser } from "../../server/auth";

export const meta = () => [{ title: "Sign up · EDK" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  if (await getSessionUser(context.cloudflare.env.DB, request)) throw redirect("/console");
  return null;
}

export default function Page() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="auth">
        <div className="hero-bg" aria-hidden="true"><Contours seed={23} /></div>
        <AuthForm mode="sign-up" />
      </main>
    </div>
  );
}
