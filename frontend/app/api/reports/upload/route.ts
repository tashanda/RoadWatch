import { beginReportUpload } from "@/lib/server/reports";

export const runtime = "nodejs";

export function POST(request: Request) {
  return beginReportUpload(request);
}
