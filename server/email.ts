// Transactional email through Cloudflare Email Sending (the EMAIL send_email binding).
import { env } from "cloudflare:workers";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string, action: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4efe6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1a15">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fbf8f2;border:1px solid #ded5c5;border-radius:10px;padding:32px">
<tr><td style="font-family:Georgia,serif;font-size:22px;font-weight:600;letter-spacing:-.02em">&#9670; edk</td></tr>
<tr><td style="padding-top:24px;font-family:Georgia,serif;font-size:24px;line-height:1.2">${escape(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#685f51">${body}</td></tr>
<tr><td style="padding-top:24px"><a href="${escape(action.url)}" style="display:inline-block;background:#e0a458;color:#1a130a;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:6px">${escape(action.label)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:12px;line-height:1.5;color:#8c8373">Or paste this link into your browser:<br><span style="word-break:break-all">${escape(action.url)}</span></td></tr>
</table>
<p style="font-size:12px;color:#8c8373;margin-top:16px">EDK · Compass for Machines · edk.earth</p>
</td></tr></table></body></html>`;
}

export async function sendVerificationEmail(to: string, name: string, url: string) {
  const binding = (env as unknown as { EMAIL?: SendEmail }).EMAIL;
  if (!binding) throw new Error("Email sending is not configured.");
  const from = process.env.EMAIL_FROM || "hello@edk.earth";
  await binding.send({
    from: { name: "EDK", email: from },
    to,
    subject: "Verify your email for EDK",
    text: `Hi${name ? ` ${name}` : ""},\n\nConfirm your email to finish creating your EDK account:\n${url}\n\nIf you didn't sign up, ignore this email.\n\nEDK · edk.earth`,
    html: layout("Confirm your email", `Hi${name ? ` ${escape(name)}` : ""}, confirm this address to finish creating your EDK account. Your 500 free CU are waiting. If you didn't sign up, you can ignore this email.`, { label: "Verify email", url }),
  });
}
