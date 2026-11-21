import { cancelReportUpload } from "@/lib/server/reports";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteParams) {
  return cancelReportUpload(request, (await params).id);
}
