export class AuthError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) {
    super(message);
  }
}

export function authResponse(value: unknown, status = 200, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  result.set("Referrer-Policy", "no-referrer");
  return Response.json(value, { status, headers: result });
}

export async function readAuthBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new AuthError("Origem inválida.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new AuthError("Envie os dados em JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("Dados inválidos.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new AuthError("Dados muito grandes.", 413);
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new AuthError("JSON inválido."); }
}

export function normalizedEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AuthError("Informe um e-mail válido.");
  return email;
}

export function validatedPassword(value: unknown, newPassword = true) {
  if (typeof value !== "string" || value.length < (newPassword ? 12 : 1) || value.length > 200)
    throw new AuthError(newPassword ? "Use uma senha de 12 a 200 caracteres." : "Informe uma senha válida.");
  return value;
}
