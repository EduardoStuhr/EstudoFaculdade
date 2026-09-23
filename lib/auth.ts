import { SignJWT, jwtVerify } from "jose";
import { env } from "cloudflare:workers";

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
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: salt.buffer as ArrayBuffer,
        iterations,
      },
      key,
      HASH_BYTES * 8,
    ),
  );
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

export async function createSession(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("estudofaculdade")
    .setAudience("estudofaculdade-app")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
}

function readCookie(request: Request, name: string) {
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

export async function getAuthenticatedUserId(request: Request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: "estudofaculdade",
      audience: "estudofaculdade-app",
    });
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
