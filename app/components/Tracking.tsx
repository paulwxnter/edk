// Product analytics (PostHog) and the Intercom messenger, started in the browser only. Both are left off the
// embed host (maps on other people's sites) and off local development.
import { useEffect } from "react";
import { useUser } from "./chrome";

const POSTHOG_TOKEN = "phc_qgMuvRJtYv9YmHrEZ4Rtctx9ke7MrifgscWsVW3gMiZd";
const INTERCOM_APP_ID = "t4p4s0qe";

const live = () => typeof window !== "undefined" && !location.hostname.startsWith("embed.") && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";

export default function Tracking() {
  const user = useUser();

  // PostHog: events go through edk.earth/_t (proxied to PostHog in the Worker) so blockers don't drop them.
  useEffect(() => {
    if (!live()) return;
    let cancelled = false;
    import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      if (!posthog.__loaded) {
        posthog.init(POSTHOG_TOKEN, {
          api_host: "/_t",
          ui_host: "https://us.posthog.com",
          defaults: "2025-05-24",
          capture_pageview: "history_change",
          person_profiles: "identified_only",
        });
      }
      if (user) posthog.identify(user.id, { email: user.email, name: user.name });
      else if (posthog._isIdentified?.()) posthog.reset();
    });
    return () => void (cancelled = true);
  }, [user?.id]);

  // Intercom, in EDK's colours. Signed-in people are known to it by their account.
  useEffect(() => {
    if (!live()) return;
    let cancelled = false;
    import("@intercom/messenger-js-sdk").then(({ default: Intercom }) => {
      if (cancelled) return;
      Intercom({
        app_id: INTERCOM_APP_ID,
        action_color: "#e0a458",
        background_color: "#13110e",
        ...(user ? { user_id: user.id, name: user.name, email: user.email, created_at: user.createdAt ?? undefined } : {}),
      } as Parameters<typeof Intercom>[0]);
    });
    return () => void (cancelled = true);
  }, [user?.id]);

  return null;
}
