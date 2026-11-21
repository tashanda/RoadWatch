import { getReport } from "@/lib/server/reports";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  return getReport((await params).id);
}
