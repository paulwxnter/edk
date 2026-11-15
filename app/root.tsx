import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { getSessionUser } from "../server/auth";
import Tracking from "./components/Tracking";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const host = new URL(request.url).hostname;
  // The embed host never needs a session.
  if (host.startsWith("embed.")) return { user: null };
  return { user: await getSessionUser(context.cloudflare.env.DB, request) };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#13110e" />
        <meta property="og:image" content="https://edk.earth/og.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <Tracking />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Off the map" : "Error";
    details = error.status === 404 ? "This page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  return (
    <main className="site">
      <section className="page-hero">
        <h1>{message}</h1>
        <p>{details}</p>
        <p style={{ marginTop: "1.5rem" }}><a className="btn" href="/">Back to edk.earth</a></p>
        {stack ? <pre className="code" style={{ padding: "1rem", overflowX: "auto" }}>{stack}</pre> : null}
      </section>
    </main>
  );
}
