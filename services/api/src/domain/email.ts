import nodemailer from "nodemailer";

export function recoveryPublicPayload<T extends Record<string, unknown>>(
  emailSent: boolean,
  developmentExtras: T,
): { emailSent: boolean } | ({ emailSent: boolean } & T) {
  if (process.env.NODE_ENV === "production") return { emailSent };
  return { emailSent, ...developmentExtras };
}

export async function sendTransactionalEmail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const raw = process.env.SMTP_URL?.trim();
  const from = process.env.SMTP_FROM?.trim() || "Guardian <no-reply@guardian.app>";
  if (!raw) return false;
  const url = new URL(raw);
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  const transporter = nodemailer.createTransport({
    host: url.hostname,
    port,
    secure,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
  });
  await transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return true;
}
