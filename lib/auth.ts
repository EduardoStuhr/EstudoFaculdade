import { SignJWT, jwtVerify } from "jose";
import { env } from "cloudflare:workers";
import { pbkdf2 } from "node:crypto";

const SESSION_COOKIE = "estudofaculdade_session";
const HASH_VERSION = "v1";
const HASH_ALGORITHM = "pbkdf2-sha256";
const HASH_ITERATIONS = 600_000;
const HASH_BYTES = 32;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  // nodejs_compat supports the existing 600k hashes without WebCrypto's
  // per-call PBKDF2 iteration cap on Workers.
  return new Promise<Uint8Array>((resolve, reject) => {
    pbkdf2(password, salt, iterations, HASH_BYTES, "sha256", (error, key) => {
      if (error) reject(error);
      else resolve(new Uint8Array(key));
    });
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, HASH_ITERATIONS);
  return `${HASH_VERSION}$${HASH_ALGORITHM}$${HASH_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password: string, serialized: string) {
  const [version, algorithm, iterationValue, saltValue, hashValue] =
    serialized.split("$");
  const iterations = Number(iterationValue);
  if (
    version !== HASH_VERSION ||
    algorithm !== HASH_ALGORITHM ||
    !Number.isSafeInteger(iterations) ||
    iterations < 1 ||
    iterations > HASH_ITERATIONS ||
    !saltValue ||
    !hashValue
  )
    return false;
  try {
    const expected = fromBase64Url(hashValue);
    const actual = await derive(password, fromBase64Url(saltValue), iterations);
    if (expected.length !== actual.length) return false;
    let different = 0;
    for (let index = 0; index < expected.length; index += 1)
      different |= expected[index] ^ actual[index];
    return different === 0;
  } catch {
    return false;
  }
}

function secret() {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32)
    throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres.");
  return encoder.encode(env.JWT_SECRET);
}

export function assertAuthConfiguration() {
  secret();
}

export async function createSession(userId: string, sessionVersion: number) {
  const id = crypto.randomUUID();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = await new SignJWT({ version: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(id)
    .setIssuer("estudofaculdade")
    .setAudience("estudofaculdade-app")
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secret());
  await env.DB!.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires).run();
  return token;
}

function readCookie(request: Request, name: string) {
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

async function sessionPayload(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: "estudofaculdade",
      audience: "estudofaculdade-app",
    });
    return typeof payload.sub === "string" && typeof payload.jti === "string"
      && Number.isSafeInteger(payload.version) ? payload : null;
  } catch {
    return null;
  }
}

export async function getAuthenticatedUserId(request: Request) {
  const payload = await sessionPayload(request);
  if (!payload) return null;
  const user = await env.DB!.prepare(`SELECT u.id FROM users u
    JOIN auth_sessions s ON s.user_id = u.id
    WHERE u.id = ? AND u.email_verified_at IS NOT NULL
      AND u.session_version = ? AND s.id = ? AND s.expires_at > ?`)
    .bind(payload.sub, payload.version, payload.jti, Math.floor(Date.now() / 1000))
    .first<{ id: string }>();
  return user?.id ?? null;
}

export async function revokeSession(request: Request) {
  const payload = await sessionPayload(request);
  if (payload) await env.DB!.prepare("DELETE FROM auth_sessions WHERE id = ? AND user_id = ?")
    .bind(payload.jti, payload.sub).run();
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
