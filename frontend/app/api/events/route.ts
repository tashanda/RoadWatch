import { createEvent, listEvents } from "@/lib/server/events";

export const runtime = "nodejs";

export function GET(request: Request) {
  return listEvents(request);
}

export function POST(request: Request) {
  return createEvent(request);
}
