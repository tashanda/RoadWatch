import { ingestTelemetry, latestTelemetry } from "@/lib/server/telemetry";

export const runtime = "nodejs";

export function GET() {
  return latestTelemetry();
}

export function POST(request: Request) {
  return ingestTelemetry(request);
}
