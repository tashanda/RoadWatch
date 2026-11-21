import {
  ingestDeviceEvent,
  listDeviceEvents,
} from "@/lib/server/device-events";

export const runtime = "nodejs";

export function GET(request: Request) {
  return listDeviceEvents(request);
}

export function POST(request: Request) {
  return ingestDeviceEvent(request);
}
