import { getDb } from "@/db";
import { users } from "@/db/schema";
import { env } from "cloudflare:workers";
import {
  assertAuthConfiguration,
  createSession,
  hashPassword,
  sessionCookie,
  verifyPassword,
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
      email?: unknown;
      password?: unknown;
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    let user = email
      ? await getDb().query.users.findFirst({
          where: (table, { eq }) => eq(table.email, email),
        })
      : null;
    const canSeedLocalAdmin =
      new URL(request.url).protocol === "http:" &&
      env.DEV_SEED_ADMIN === "true" &&
      email === "admin@local.test" &&
      password === "123";
    if (!user && canSeedLocalAdmin) {
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      await getDb().insert(users).values({
        id,
        name: "Admin",
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
      });
      user = { id, name: "Admin", email, passwordHash, createdAt: "" };
    }
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return response({ error: "E-mail ou senha incorretos." }, 401);
    const token = await createSession(user.id);
    return response(
      { user: { id: user.id, name: user.name, email: user.email } },
      200,
      { "Set-Cookie": sessionCookie(token, request) },
    );
  } catch (error) {
    console.error("Login error", error);
    if (error instanceof Error && error.message.includes("JWT_SECRET"))
      return response({ error: error.message }, 503);
    if (error instanceof Error && error.message.includes("no such table"))
      return response(
        {
          error:
            "Banco ainda não foi migrado. Aplique as migrations D1 antes de entrar.",
        },
        503,
      );
    return response({ error: "Não foi possível entrar agora." }, 503);
  }
}
