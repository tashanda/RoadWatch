import { checkSupabaseReadiness } from "@/lib/server/supabase-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await checkSupabaseReadiness();
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error(
      "RoadWatch readiness check failed",
      error instanceof Error ? error.message : "Unexpected non-error value",
    );
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
