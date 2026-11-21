import { clearSimulatedEvents } from "@/lib/server/events";

export const runtime = "nodejs";

export function DELETE() {
  return clearSimulatedEvents();
}
