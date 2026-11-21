import { createReport, listReports } from "@/lib/server/reports";

export const runtime = "nodejs";

export function GET(request: Request) {
  return listReports(request);
}

export function POST(request: Request) {
  return createReport(request);
}
