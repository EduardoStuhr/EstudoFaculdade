import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  assertAuthConfiguration,
  createSession,
  hashPassword,
  sessionCookie,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

function response(value: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(request: Request) {
  try {
    assertAuthConfiguration();
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return response({ error: "Origem inválida." }, 403);
    const body = (await request.json()) as {
      name?: unknown;
      email?: unknown;
      password?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (
      !name ||
      name.length > 100 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      email.length > 254 ||
      password.length < 12 ||
      password.length > 200
    ) {
      return response(
        {
          error:
            "Informe nome, e-mail válido e uma senha de ao menos 12 caracteres.",
        },
        400,
      );
    }
    const exists = await getDb().query.users.findFirst({
      where: (table, { eq }) => eq(table.email, email),
    });
    if (exists)
      return response({ error: "Este e-mail já está cadastrado." }, 409);
    const id = crypto.randomUUID();
    await getDb()
      .insert(users)
      .values({
        id,
        name,
        email,
        passwordHash: await hashPassword(password),
        createdAt: new Date().toISOString(),
      });
    const token = await createSession(id);
    return response({ user: { id, name, email } }, 201, {
      "Set-Cookie": sessionCookie(token, request),
    });
  } catch (error) {
    console.error("Register error", error);
    if (error instanceof Error && error.message.includes("JWT_SECRET"))
      return response({ error: error.message }, 503);
    if (error instanceof Error && error.message.includes("no such table"))
      return response(
        {
          error:
            "Banco ainda não foi migrado. Aplique as migrations D1 antes de criar uma conta.",
        },
        503,
      );
    return response({ error: "Não foi possível criar sua conta." }, 503);
  }
}
