import { env } from "cloudflare:workers";

export function emailConfiguration() {
  if (!env.APP_URL || !env.EMAIL_FROM || !env.RESEND_API_KEY)
    throw new Error("Email configuration missing");
  const url = new URL(env.APP_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("APP_URL must be a trusted HTTPS origin (HTTP only on localhost)");
  return { origin: url.origin, from: env.EMAIL_FROM, key: env.RESEND_API_KEY };
}

export async function sendAuthEmail(email: string, purpose: "verify" | "reset", token: string) {
  const config = emailConfiguration();
  // Fragments are not sent to HTTP servers, access logs or Referer headers.
  const url = `${config.origin}/#auth=${purpose}&token=${token}`;
  const action = purpose === "verify" ? "Confirme seu e-mail" : "Redefina sua senha";
  const duration = purpose === "verify" ? "24 horas" : "30 minutos";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: config.from, to: [email], subject: `${action} — Caderno de Estudos`,
      text: `${action} no Caderno de Estudos:\n\n${url}\n\nEste link é de uso único e expira em ${duration}.\nSe você não solicitou, ignore esta mensagem.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Email provider rejected request");
}
