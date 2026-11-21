import { getEvent } from "@/lib/server/events";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  return getEvent((await params).id);
}
