import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  beginReportUpload,
  createReport,
  getReportPhoto,
} from "./reports";
import { ingestDeviceEvent } from "./device-events";
import {
  type ReportRow,
  type RoadWatchStore,
  type UploadTicket,
} from "./supabase-store";

const requestHeaders = {
  "Content-Type": "application/json",
  "X-Real-IP": "203.0.113.12",
};

function makeStore(overrides: Partial<RoadWatchStore> = {}) {
  let ticket: UploadTicket | null = null;
  const uploaded: Array<{ path: string; bytes: Uint8Array }> = [];
  const removed: string[] = [];
  let report: ReportRow | null = null;

  const defaults: RoadWatchStore = {
    consumeRateLimit: async () => true,
    createSignedUpload: async () => "signed-upload-token",
    createSignedDownload: async () => "https://storage.example/signed/photo",
    createUploadTicket: async (created) => {
      ticket = created;
    },
    claimUploadTicket: async (id, uploaderHash) => {
      if (!ticket || ticket.id !== id || ticket.uploader_hash !== uploaderHash) {
        return null;
      }
      return ticket;
    },
    deleteUploadTicket: async () => {
      ticket = null;
    },
    uploadPhoto: async (path, bytes) => {
      uploaded.push({ path, bytes });
    },
    downloadPhoto: async () => new Uint8Array(await makePng()),
    removePhoto: async (path) => {
      removed.push(path);
    },
    insertReport: async (row) => {
      report = row;
      return row;
    },
    listReports: async () => ({ items: report ? [report] : [], total: report ? 1 : 0 }),
    findReport: async () => report,
    insertEvent: async (event) => ({ ...event, id: 1 }),
    listEvents: async () => ({ items: [], total: 0 }),
    findEvent: async () => null,
    clearSimulatedEvents: async () => {},
    insertDeviceEvent: async (event) => ({
      event,
      duplicate: false,
      conflict: false,
    }),
    listDeviceEvents: async () => ({ items: [], total: 0 }),
    ...overrides,
  };
  return { store: defaults, uploaded, removed, getReport: () => report };
}

async function makePng() {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 80, g: 120, b: 160 },
    },
  })
    .png()
    .toBuffer();
}

async function beginValidUpload(store: RoadWatchStore) {
  const request = new Request("https://roadwatch.example/api/reports/upload", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({ content_type: "image/png", size: (await makePng()).byteLength }),
  });
  return beginReportUpload(request, () => store);
}

function reportRequest(uploadId: string, latitude = 27.95, longitude = -82.45) {
  return new Request("https://roadwatch.example/api/reports", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      upload_id: uploadId,
      latitude,
      longitude,
      severity: "high",
      description: "Near the west entrance",
    }),
  });
}

afterEach(() => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_STORAGE_BUCKET;
  delete process.env.ROADWATCH_DEVICE_TOKEN;
  vi.restoreAllMocks();
});

describe("community report API", () => {
  it("rejects unsupported image types before issuing an upload token", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-hmac-key";
    const createSignedUpload = vi.fn(async () => "signed-upload-token");
    const { store } = makeStore({ createSignedUpload });
    const response = await beginReportUpload(
      new Request("https://roadwatch.example/api/reports/upload", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ content_type: "image/svg+xml", size: 12 }),
      }),
      () => store,
    );

    expect(response.status).toBe(415);
    expect(createSignedUpload).not.toHaveBeenCalled();
  });

  it("validates coordinates before claiming a staged upload", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-hmac-key";
    const claimUploadTicket = vi.fn(async () => null);
    const { store } = makeStore({ claimUploadTicket });
    const response = await createReport(reportRequest("550e8400-e29b-41d4-a716-446655440000", 91), () => store);

    expect(response.status).toBe(422);
    expect(claimUploadTicket).not.toHaveBeenCalled();
  });

  it("sanitizes and persists a valid report with a generated photo key", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-hmac-key";
    process.env.SUPABASE_STORAGE_BUCKET = "roadwatch-reports";
    const { store, uploaded, getReport } = makeStore();
    const uploadResponse = await beginValidUpload(store);
    const { upload_id: uploadId } = (await uploadResponse.json()) as {
      upload_id: string;
    };

    const response = await createReport(reportRequest(uploadId), () => store);
    const body = (await response.json()) as {
      id: string;
      photo_url: string;
      source: string;
      status: string;
    };
    const stored = getReport();

    expect(response.status).toBe(201);
    expect(body.source).toBe("community");
    expect(body.status).toBe("unverified");
    expect(body.photo_url).toBe(`/api/reports/${body.id}/photo`);
    expect(stored?.photo_key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/i);
    expect(stored?.description).toBe("Near the west entrance");
    expect(uploaded).toHaveLength(1);
    expect((await sharp(uploaded[0].bytes).metadata()).format).toBe("jpeg");
  });

  it("removes staged and final photos when photo persistence fails", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-hmac-key";
    process.env.SUPABASE_STORAGE_BUCKET = "roadwatch-reports";
    const insertReport = vi.fn(async (row: ReportRow) => row);
    const { store, removed } = makeStore({
      uploadPhoto: async () => {
        throw new Error("storage unavailable");
      },
      insertReport,
    });
    const uploadResponse = await beginValidUpload(store);
    const { upload_id: uploadId } = (await uploadResponse.json()) as {
      upload_id: string;
    };

    const response = await createReport(reportRequest(uploadId), () => store);

    expect(response.status).toBe(503);
    expect(insertReport).not.toHaveBeenCalled();
    expect(removed.some((path) => path.startsWith("staging/"))).toBe(true);
    expect(removed.some((path) => path.startsWith("reports/"))).toBe(true);
  });

  it("serves private report images through short-lived signed URLs", async () => {
    const signedUrl = "https://storage.example/signed/private-photo";
    const row: ReportRow = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      latitude: 27.95,
      longitude: -82.45,
      severity: "medium",
      description: null,
      photo_key: "reports/550e8400-e29b-41d4-a716-446655440000.jpg",
      created_at: new Date().toISOString(),
      source: "community",
      status: "unverified",
    };
    const createSignedDownload = vi.fn(async () => signedUrl);
    const { store } = makeStore({
      findReport: async () => row,
      createSignedDownload,
    });

    const response = await getReportPhoto(row.id, () => store);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(signedUrl);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(createSignedDownload).toHaveBeenCalledWith(row.photo_key, 60);
  });

  it("rejects device uploads without the configured token", async () => {
    process.env.ROADWATCH_DEVICE_TOKEN = "device-test-token";
    const storeFactory = vi.fn(() => {
      throw new Error("storage should not be accessed");
    });
    const response = await ingestDeviceEvent(
      new Request("https://roadwatch.example/api/device-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      storeFactory,
    );

    expect(response.status).toBe(401);
    expect(storeFactory).not.toHaveBeenCalled();
  });

  it("rejects malformed diagnostic JSON without inserting an event", async () => {
    process.env.ROADWATCH_DEVICE_TOKEN = "device-test-token";
    const insertDeviceEvent = vi.fn();
    const { store } = makeStore({ insertDeviceEvent });
    const response = await ingestDeviceEvent(
      new Request("https://roadwatch.example/api/device-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Token": "device-test-token",
        },
        body: "{",
      }),
      () => store,
    );

    expect(response.status).toBe(400);
    expect(insertDeviceEvent).not.toHaveBeenCalled();
  });

  it("returns idempotent success for a repeated device event ID", async () => {
    process.env.ROADWATCH_DEVICE_TOKEN = "device-test-token";
    const event = {
      event_id: "550e8400-e29b-41d4-a716-446655440000",
      device_id: "roadwatch-esp32-01",
      timestamp: new Date().toISOString(),
      latitude: null,
      longitude: null,
      sensor_summary: "possible_pothole impact=8.2m/s2",
      severity: "high" as const,
      event_type: "pothole" as const,
      impact_magnitude: 8.2,
      source: "esp32_sensor" as const,
      status: "unverified" as const,
      received_at: new Date().toISOString(),
    };
    const { store } = makeStore({
      insertDeviceEvent: async () => ({
        event,
        duplicate: true,
        conflict: false,
      }),
    });
    const response = await ingestDeviceEvent(
      new Request("https://roadwatch.example/api/device-events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Token": "device-test-token",
        },
        body: JSON.stringify({
          ...event,
          received_at: undefined,
        }),
      }),
      () => store,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ duplicate: true });
  });
});
