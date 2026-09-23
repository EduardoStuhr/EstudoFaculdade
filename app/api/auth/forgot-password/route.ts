import { handleAuth } from "@/lib/auth-handler";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleAuth(request, "forgot-password");
}
