import { metric } from "@vercel/functions";
import sharp, { type Metadata } from "sharp";
import { randomUUID } from "node:crypto";

import {
  ApiError,
  isRecord,
  jsonError,
  queryLimit,
  reportClientHash,
  reportError,
  type StoreFactory,
  validSeverity,
} from "./http";
import {
  createSupabaseStore,
  type ReportRow,
  type RoadWatchStore,
} from "./supabase-store";

const maximumImageBytes = 5 * 1024 * 1024;
const maximumImagePixels = 25_000_000;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageFormatTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function reportResponse(row: ReportRow) {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    severity: row.severity,
    description: row.description,
    photo_url: `/api/reports/${row.id}/photo`,
    created_at: row.created_at,
    source: row.source,
    status: row.status,
  };
}

async function cleanupUpload(
  store: RoadWatchStore,
  id: string,
  path: string,
): Promise<void> {
  const results = await Promise.allSettled([
    store.removePhoto(path),
    store.deleteUploadTicket(id),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "Could not clean up temporary report upload",
        result.reason instanceof Error ? result.reason.message : "Unknown error",
      );
    }
  }
}

async function sanitizeImage(
  bytes: Uint8Array,
  expectedType: string,
): Promise<Uint8Array> {
  if (!bytes.length) throw new ApiError(400, "A photo is required.");
  if (bytes.length > maximumImageBytes) {
    throw new ApiError(413, "Photo must be 5 MB or smaller.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: maximumImagePixels,
    }).metadata();
  } catch {
    throw new ApiError(415, "Photo content is not a valid supported image.");
  }

  const actualType = metadata.format ? imageFormatTypes[metadata.format] : undefined;
  if (!actualType || !supportedImageTypes.has(actualType)) {
    throw new ApiError(415, "Photo must be a valid JPG, PNG, or WebP image.");
  }
  if (actualType !== expectedType) {
    throw new ApiError(415, "Photo content does not match the selected image type.");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > maximumImagePixels
  ) {
    throw new ApiError(413, "Photo dimensions are too large.");
  }

  try {
    const cleaned = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: maximumImagePixels,
    })
      .rotate()
      .resize({
        width: 4096,
        height: 4096,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86 })
      .toBuffer();
    if (cleaned.byteLength > maximumImageBytes) {
      throw new ApiError(413, "Processed photo must be 5 MB or smaller.");
    }
    return new Uint8Array(cleaned);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(415, "Photo content could not be processed.");
  }
}

function parseCoordinates(value: unknown, name: string, maximum: number): number {
  const coordinate =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(coordinate) || coordinate < -maximum || coordinate > maximum) {
    throw new ApiError(422, `${name} must be a valid coordinate.`);
  }
  return coordinate;
}

function parseReportFields(value: unknown) {
  if (!isRecord(value)) throw new ApiError(422, "Report fields are invalid.");
  if (!validSeverity(value.severity)) {
    throw new ApiError(422, "Severity must be low, medium, or high.");
  }
  if (
    value.description !== undefined &&
    value.description !== null &&
    (typeof value.description !== "string" || value.description.length > 500)
  ) {
    throw new ApiError(422, "Description must be 500 characters or fewer.");
  }
  if (typeof value.upload_id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.upload_id)) {
    throw new ApiError(422, "A valid upload_id is required.");
  }
  return {
    uploadId: value.upload_id,
    latitude: parseCoordinates(value.latitude, "Latitude", 90),
    longitude: parseCoordinates(value.longitude, "Longitude", 180),
    severity: value.severity,
    description:
      typeof value.description === "string" ? value.description.trim() || null : null,
  };
}

async function withStore(
  label: string,
  storeFactory: StoreFactory,
  run: (store: RoadWatchStore) => Promise<Response>,
): Promise<Response> {
  try {
    return await run(storeFactory());
  } catch (error) {
    if (error instanceof ApiError) return jsonError(error);
    return reportError(label, error);
  }
}

export async function beginReportUpload(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const startedAt = performance.now();
  let outcome = "error";
  const response = await withStore("Could not begin report photo upload", storeFactory, async (store) => {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiError(400, "Upload details must be valid JSON.");
    }
    if (!isRecord(input)) throw new ApiError(422, "Upload details are invalid.");
    if (
      typeof input.content_type !== "string" ||
      !supportedImageTypes.has(input.content_type)
    ) {
      throw new ApiError(415, "Choose a JPG, PNG, or WebP image.");
    }
    if (
      typeof input.size !== "number" ||
      !Number.isInteger(input.size) ||
      input.size < 1 ||
      input.size > maximumImageBytes
    ) {
      throw new ApiError(413, "Photo must be larger than 0 bytes and 5 MB or smaller.");
    }

    const uploaderHash = reportClientHash(request);
    const allowed = await store.consumeRateLimit(`uploads:${uploaderHash}`, 20, 3600);
    if (!allowed) {
      throw new ApiError(429, "Too many upload attempts. Try again later.", {
        "Retry-After": "3600",
      });
    }

    const uploadId = randomUUID();
    const uploadPath = `staging/${uploadId}`;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!bucket) throw new Error("Missing required environment variable: SUPABASE_STORAGE_BUCKET");
    const token = await store.createSignedUpload(uploadPath);
    const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();
    await store.createUploadTicket({
      id: uploadId,
      upload_path: uploadPath,
      uploader_hash: uploaderHash,
      content_type: input.content_type,
      expected_size: input.size,
      expires_at: expiresAt,
    });
    outcome = "success";
    return Response.json(
      { upload_id: uploadId, path: uploadPath, token, bucket },
      { status: 201 },
    );
  });
  metric("roadwatch.report_uploads.started", 1, { outcome });
  metric("roadwatch.report_uploads.duration_ms", performance.now() - startedAt);
  return response;
}

export async function cancelReportUpload(
  request: Request,
  id: string,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonError(new ApiError(422, "A valid upload ID is required."));
  }
  return withStore("Could not cancel report photo upload", storeFactory, async (store) => {
    const ticket = await store.claimUploadTicket(
      id,
      reportClientHash(request),
      new Date().toISOString(),
    );
    if (!ticket) throw new ApiError(404, "Upload not found or expired.");
    await cleanupUpload(store, ticket.id, ticket.upload_path);
    return new Response(null, { status: 204 });
  });
}

export async function createReport(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const startedAt = performance.now();
  let outcome = "error";
  const cleanupState: {
    ticket: { id: string; upload_path: string } | null;
    store: RoadWatchStore | null;
  } = { ticket: null, store: null };
  const response = await withStore("Could not create community report", storeFactory, async (activeStore) => {
    cleanupState.store = activeStore;
    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(415, "Report details must be sent as JSON.");
    }
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiError(400, "Report details must be valid JSON.");
    }
    const fields = parseReportFields(input);
    const uploaderHash = reportClientHash(request);
    const allowed = await activeStore.consumeRateLimit(
      `reports:${uploaderHash}`,
      5,
      3600,
    );
    if (!allowed) {
      throw new ApiError(429, "Too many reports from this connection. Try again later.", {
        "Retry-After": "3600",
      });
    }

    const ticket = await activeStore.claimUploadTicket(
      fields.uploadId,
      uploaderHash,
      new Date().toISOString(),
    );
    if (!ticket) throw new ApiError(404, "Photo upload not found or expired.");
    cleanupState.ticket = { id: ticket.id, upload_path: ticket.upload_path };

    const raw = await activeStore.downloadPhoto(ticket.upload_path);
    if (!raw) throw new ApiError(404, "Uploaded photo could not be found.");
    if (raw.byteLength !== ticket.expected_size) {
      throw new ApiError(413, "Uploaded photo size does not match the selected file.");
    }
    const sanitizedPhoto = await sanitizeImage(raw, ticket.content_type);
    const id = randomUUID();
    const photoKey = `reports/${id}.jpg`;
    const row: ReportRow = {
      id,
      latitude: fields.latitude,
      longitude: fields.longitude,
      severity: fields.severity,
      description: fields.description,
      photo_key: photoKey,
      created_at: new Date().toISOString(),
      source: "community",
      status: "unverified",
    };
    try {
      await activeStore.uploadPhoto(photoKey, sanitizedPhoto);
      const saved = await activeStore.insertReport(row);
      outcome = "success";
      return Response.json(reportResponse(saved), { status: 201 });
    } catch (error) {
      try {
        await activeStore.removePhoto(photoKey);
      } catch (cleanupError) {
        console.error(
          "Could not remove orphaned community report image",
          cleanupError instanceof Error ? cleanupError.message : "Unknown error",
        );
      }
      throw error;
    }
  });

  const cleanupStore = cleanupState.store;
  const claimedTicket = cleanupState.ticket;
  if (cleanupStore && claimedTicket) {
    await cleanupUpload(cleanupStore, claimedTicket.id, claimedTicket.upload_path);
  }
  metric("roadwatch.reports.finalized", 1, { outcome });
  metric("roadwatch.reports.duration_ms", performance.now() - startedAt);
  return response;
}

export async function listReports(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const limit = queryLimit(new URL(request.url));
  if (limit === null) return jsonError(new ApiError(422, "Limit must be between 1 and 500."));
  return withStore("Could not list community reports", storeFactory, async (store) => {
    const result = await store.listReports(limit);
    return Response.json({
      items: result.items.map(reportResponse),
      total: result.total,
    });
  });
}

export async function getReport(
  id: string,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonError(new ApiError(422, "Report ID must be a UUID."));
  }
  return withStore("Could not retrieve community report", storeFactory, async (store) => {
    const report = await store.findReport(id);
    if (!report) throw new ApiError(404, "Report not found");
    return Response.json(reportResponse(report));
  });
}

export async function getReportPhoto(
  id: string,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonError(new ApiError(422, "Report ID must be a UUID."));
  }
  return withStore("Could not retrieve community report image", storeFactory, async (store) => {
    const report = await store.findReport(id);
    if (!report) throw new ApiError(404, "Report not found");
    const signedUrl = await store.createSignedDownload(report.photo_key, 60);
    return new Response(null, {
      status: 307,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
