import { env } from "cloudflare:workers";
import { assertAuthConfiguration, createSession, hashPassword, sessionCookie, verifyPassword } from "./auth";
import { emailConfiguration, sendAuthEmail } from "./auth-email";
import { AuthError, authResponse, normalizedEmail, readAuthBody, validatedPassword } from "./auth-http";

type Action = "register" | "login" | "resend-verification" | "forgot-password" | "verify-email" | "reset-password";
type User = { id: string; name: string; email: string; password_hash: string; email_verified_at: string | null; session_version: number };
const encoder = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);
const db = () => {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
};
const genericMessage = "Se o e-mail estiver apto, você receberá um link. Confira também o spam. Se necessário, solicite o reenvio da confirmação.";
const dummyHash = "v1$pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    byte => byte.toString(16).padStart(2, "0")).join("");
}

async function limit(scope: string, value: string, maximum: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.JWT_SECRET!),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${scope}:${value}`)));
  const id = Array.from(signed, byte => byte.toString(16).padStart(2, "0")).join("");
  const time = now();
  // A single atomic UPSERT enforces the limit across Worker instances.
  const result = await db().prepare(`INSERT INTO auth_rate_limits (key, attempts, expires_at)
    VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts, expires_at`).bind(id, time + 900, time, time)
    .first<{ attempts: number; expires_at: number }>();
  if (!result || result.attempts > maximum)
    throw new AuthError("Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429,
      Math.max(1, (result?.expires_at ?? time + 900) - time));
}

async function cleanup() {
  // Bounded cleanup also removes expired records on low-traffic installations.
  await db().batch([
    db().prepare("DELETE FROM auth_tokens WHERE token_hash IN (SELECT token_hash FROM auth_tokens WHERE expires_at <= ? LIMIT 100)").bind(now()),
    db().prepare("DELETE FROM auth_sessions WHERE id IN (SELECT id FROM auth_sessions WHERE expires_at <= ? LIMIT 100)").bind(now()),
    db().prepare("DELETE FROM auth_rate_limits WHERE key IN (SELECT key FROM auth_rate_limits WHERE expires_at <= ? LIMIT 100)").bind(now()),
  ]);
}

async function issueToken(user: User, purpose: "verify" | "reset") {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = await digest(token);
  await db().prepare(`INSERT INTO auth_tokens (token_hash, user_id, purpose, session_version, expires_at)
    VALUES (?, ?, ?, ?, ?)`).bind(hash, user.id, purpose, user.session_version,
      now() + (purpose === "verify" ? 86400 : 1800)).run();
  try {
    await sendAuthEmail(user.email, purpose, token);
  } catch {
    await db().prepare("DELETE FROM auth_tokens WHERE token_hash = ?").bind(hash).run();
    // No address, token, password, or provider response is written to logs.
    throw new Error("Email delivery unavailable");
  }
}

async function consumeToken(body: Record<string, unknown>, purpose: "verify" | "reset") {
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
    throw new AuthError("Link inválido ou expirado. Solicite um novo.");
  const password = validatedPassword(body.password);
  const hash = await digest(body.token);
  // Cheap preflight avoids password hashing for arbitrary/expired tokens.
  const valid = await db().prepare(`SELECT t.user_id FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.purpose = ? AND t.expires_at > ?
      AND t.session_version = u.session_version`).bind(hash, purpose, now()).first();
  if (!valid) throw new AuthError("Link inválido ou expirado. Solicite um novo.");
  const passwordHash = await hashPassword(password);
  // D1 batch is transactional; the guarded UPDATE is the consumption point.
  // Incrementing the version invalidates every other link and old session.
  const results = await db().batch([
    db().prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1,
      email_verified_at = CASE WHEN ? = 'verify' THEN ? ELSE email_verified_at END
      WHERE id = (SELECT user_id FROM auth_tokens WHERE token_hash = ? AND purpose = ?
        AND expires_at > ? AND session_version = users.session_version)
      RETURNING id`).bind(passwordHash, purpose, new Date().toISOString(), hash, purpose, now()),
    db().prepare("DELETE FROM auth_tokens WHERE token_hash = ?").bind(hash),
  ]);
  if (!results[0].results.length) throw new AuthError("Link inválido ou expirado. Solicite um novo.");
  return authResponse({ message: purpose === "verify"
    ? "E-mail confirmado e senha definida. Você já pode entrar."
    : "Senha atualizada. Entre novamente com a nova senha." });
}

export async function handleAuth(request: Request, action: Action) {
  try {
    const body = await readAuthBody(request);
    assertAuthConfiguration();
    // Only trust Cloudflare's overwritten connecting-IP header, never X-Forwarded-For.
    await limit("ip", request.headers.get("cf-connecting-ip") ?? "local", 40);
    await cleanup();
    if (action === "verify-email" || action === "reset-password")
      return await consumeToken(body, action === "verify-email" ? "verify" : "reset");
    const email = normalizedEmail(body.email);
    if (action === "login") {
      const password = validatedPassword(body.password, false);
      await limit("login", email, 10);
      const user = await db().prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
      const matches = await verifyPassword(password, user?.password_hash ?? dummyHash);
      if (!user || !matches) return authResponse({ error: "E-mail ou senha incorretos." }, 401);
      if (!user.email_verified_at) return authResponse({ error: "Confirme seu e-mail antes de entrar.", code: "EMAIL_NOT_VERIFIED" }, 403);
      const token = await createSession(user.id, user.session_version);
      return authResponse({ user: { id: user.id, name: user.name, email: user.email } }, 200,
        { "Set-Cookie": sessionCookie(token, request) });
    }
    emailConfiguration();
    await limit("email", email, 3);
    if (action === "register") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 100) throw new AuthError("Informe um nome de até 100 caracteres.");
      const password = validatedPassword(body.password);
      // Hash on both paths to reduce account-enumeration timing differences.
      const passwordHash = await hashPassword(password);
      const user = await db().prepare(`INSERT INTO users (id, name, email, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING *`)
        .bind(crypto.randomUUID(), name, email, passwordHash, new Date().toISOString()).first<User>();
      if (user) await issueToken(user, "verify");
      // Never replace an existing account's password or create a session here.
      return authResponse({ message: genericMessage }, 202);
    }
    const user = await db().prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
    const purpose = action === "resend-verification" ? "verify" : "reset";
    if (user && (purpose === "verify" ? !user.email_verified_at : !!user.email_verified_at)) {
      try { await issueToken(user, purpose); }
      catch { console.error("Auth email delivery failed"); }
    }
    // Identical responses for absent, verified, unverified and delivery-failure cases.
    return authResponse({ message: genericMessage }, 202);
  } catch (error) {
    if (error instanceof AuthError) return authResponse({ error: error.message }, error.status,
      error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {});
    console.error("Authentication service unavailable");
    return authResponse({ error: "Serviço temporariamente indisponível. Tente novamente ou solicite o reenvio da confirmação." }, 503);
  }
}
