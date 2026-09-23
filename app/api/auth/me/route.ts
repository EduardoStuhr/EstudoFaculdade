import { getDb } from "@/db";
import { getAuthenticatedUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId)
    return Response.json(
      { error: "Não autenticado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const user = await getDb().query.users.findFirst({
    where: (table, { eq }) => eq(table.id, userId),
  });
  if (!user)
    return Response.json(
      { error: "Não autenticado." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    { user: { id: user.id, name: user.name, email: user.email } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
