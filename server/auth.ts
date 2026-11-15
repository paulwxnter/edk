import { betterAuth } from "better-auth";
import { getBalance } from "./store";
import { sendVerificationEmail } from "./email";

let cached: { db: D1Database; auth: ReturnType<typeof build> } | null = null;

function build(db: D1Database) {
  const site = process.env.SITE_URL || "https://edk.earth";
  const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
  return betterAuth({
    database: db,
    secret: process.env.BETTER_AUTH_SECRET,
    // Local development runs on port 5180.
    baseURL: import.meta.env.DEV ? "http://localhost:5180" : process.env.AUTH_BASE_URL || site,
    basePath: "/api/auth",
    trustedOrigins: [site, "https://www.edk.earth", "http://localhost:5173", "http://localhost:5180", "http://localhost:8787"],
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    // EDK's own cookie names: the site that used to live on edk.earth also ran Better Auth and left
    // "better-auth.*" cookies in browsers, which shadowed ours and dropped people back on /login.
    advanced: { cookiePrefix: "edk" },
    emailAndPassword: { enabled: true, autoSignIn: !requireVerification, minPasswordLength: 8, requireEmailVerification: requireVerification },
    // Sign-up sends a verification link through Cloudflare Email Sending; the link signs the user in.
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: requireVerification,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        if (import.meta.env.DEV) console.log("[email] verification link:", url);
        await sendVerificationEmail(user.email, user.name, url).catch((error) => console.error("[email] verification failed", error instanceof Error ? error.message : error));
      },
    },
    databaseHooks: {
      // New accounts start with the free grant.
      user: { create: { after: async (user) => void (await getBalance(db, user.id)) } },
    },
  });
}

export function getAuth(db: D1Database) {
  if (!cached || cached.db !== db) cached = { db, auth: build(db) };
  return cached.auth;
}

export async function getSessionUser(db: D1Database, request: Request) {
  const session = await getAuth(db).api.getSession({ headers: request.headers }).catch(() => null);
  if (!session?.user) return null;
  const joined = new Date(session.user.createdAt as unknown as string).getTime();
  return { id: session.user.id, email: session.user.email, name: session.user.name, createdAt: Number.isFinite(joined) ? Math.floor(joined / 1000) : null };
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
