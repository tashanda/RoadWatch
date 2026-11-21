import { createHmac, timingSafeEqual } from "node:crypto";

export type StoreFactory = () => import("./supabase-store").RoadWatchStore;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
    readonly headers?: HeadersInit,
  ) {
    super(detail);
  }
}

export function jsonError(error: ApiError): Response {
  return Response.json(
    { detail: error.message },
    { status: error.status, headers: error.headers },
  );
}

export function reportError(label: string, error: unknown): Response {
  console.error(
    label,
    error instanceof Error ? error.message : "Unexpected non-error value",
  );
  return jsonError(new ApiError(503, "RoadWatch storage is temporarily unavailable."));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validSeverity(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

export function validEventType(
  value: unknown,
): value is "pothole" | "speed_bump" | "rough_road" {
  return value === "pothole" || value === "speed_bump" || value === "rough_road";
}

export function validUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function validatedTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = new Date(value);
  if (
    Number.isNaN(timestamp.getTime()) ||
    !/(Z|[+-]\d{2}:\d{2})$/i.test(value) ||
    timestamp.getTime() > Date.now() + 5 * 60_000
  ) {
    return null;
  }
  return timestamp.toISOString();
}

export function reportClientHash(request: Request): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("x-real-ip") ?? forwarded ?? "unknown";
  return createHmac("sha256", key).update(address).digest("hex");
}

export function hasValidDeviceToken(request: Request): boolean {
  const expected = process.env.ROADWATCH_DEVICE_TOKEN;
  const provided = request.headers.get("x-device-token");
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function queryLimit(url: URL): number | null {
  const value = url.searchParams.get("limit");
  if (value === null) return 200;
  if (!/^\d+$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 500 ? limit : null;
}
