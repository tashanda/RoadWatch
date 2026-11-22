import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Severity = "low" | "medium" | "high";
export type EventType = "pothole" | "speed_bump" | "rough_road";

export type ReportRow = {
  id: string;
  latitude: number;
  longitude: number;
  severity: Severity;
  description: string | null;
  photo_key: string;
  created_at: string;
  source: "community";
  status: "unverified";
};

export type UploadTicket = {
  id: string;
  upload_path: string;
  uploader_hash: string;
  content_type: string;
  expected_size: number;
  expires_at: string;
};

export type EventRow = {
  id: number;
  latitude: number;
  longitude: number;
  severity: Severity;
  timestamp: string;
  event_type: EventType;
  simulated: boolean;
};

export type DeviceEventRow = {
  event_id: string;
  device_id: string;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  sensor_summary: string;
  severity: Severity | null;
  event_type: EventType | null;
  impact_magnitude: number | null;
  source: "esp32_sensor";
  status: "unverified";
  received_at: string;
};

export type Vector3 = [number | null, number | null, number | null];

export type TelemetryPayload = {
  imu_valid: boolean | null;
  orientation_valid: boolean | null;
  gps_valid: boolean | null;
  calibration: {
    system: number | null;
    accel: number | null;
    gyro: number | null;
    mag: number | null;
  };
  linear_accel_m_s2: Vector3 | null;
  raw_accel_m_s2: Vector3 | null;
  gyro_rad_s: Vector3 | null;
  orientation_deg: Vector3 | null;
  vertical_accel_m_s2: number | null;
  jerk_m_s3: number | null;
  vibration_rms_m_s2: number | null;
  latitude: number | null;
  longitude: number | null;
  peak: {
    vertical_accel_m_s2: number | null;
    jerk_m_s3: number | null;
    vibration_rms_m_s2: number | null;
  };
  samples_in_window: number | null;
  malformed_lines: number | null;
  last_detection: {
    timestamp: string;
    severity: Severity;
    impact_m_s2: number | null;
  } | null;
};

export type TelemetryRow = {
  device_id: string;
  payload: TelemetryPayload;
  received_at: string;
};

export type ReadinessClient = {
  from: (table: string) => {
    select: (
      columns: string,
      options: { head: true; count: "exact" },
    ) => PromiseLike<{ error: { message: string } | null }>;
  };
  storage: {
    getBucket: (
      id: string,
    ) => PromiseLike<{
      data: { public: boolean } | null;
      error: { message: string } | null;
    }>;
  };
};

const readinessTables = [
  ["events", "id"],
  ["community_reports", "id"],
  ["device_events", "event_id"],
  ["report_upload_tickets", "id"],
  ["api_rate_limits", "key"],
] as const;

export interface RoadWatchStore {
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  createSignedUpload(path: string): Promise<string>;
  createSignedDownload(path: string, expiresIn: number): Promise<string>;
  createUploadTicket(ticket: UploadTicket): Promise<void>;
  claimUploadTicket(
    id: string,
    uploaderHash: string,
    now: string,
  ): Promise<UploadTicket | null>;
  deleteUploadTicket(id: string): Promise<void>;
  uploadPhoto(path: string, bytes: Uint8Array): Promise<void>;
  downloadPhoto(path: string): Promise<Uint8Array | null>;
  removePhoto(path: string): Promise<void>;
  insertReport(report: ReportRow): Promise<ReportRow>;
  listReports(limit: number): Promise<{ items: ReportRow[]; total: number }>;
  findReport(id: string): Promise<ReportRow | null>;
  insertEvent(event: Omit<EventRow, "id">): Promise<EventRow>;
  listEvents(
    severity: Severity | null,
    limit: number,
  ): Promise<{ items: EventRow[]; total: number }>;
  findEvent(id: number): Promise<EventRow | null>;
  clearSimulatedEvents(): Promise<void>;
  insertDeviceEvent(event: DeviceEventRow): Promise<{
    event: DeviceEventRow;
    duplicate: boolean;
    conflict: boolean;
  }>;
  listDeviceEvents(limit: number): Promise<{
    items: DeviceEventRow[];
    total: number;
  }>;
  upsertTelemetry(row: TelemetryRow): Promise<void>;
  latestTelemetry(): Promise<TelemetryRow | null>;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function throwOnError(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

export function getSupabaseAdmin(): SupabaseClient {
  return createClient(
    requiredEnvironment("SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

function storageBucket(): string {
  return requiredEnvironment("SUPABASE_STORAGE_BUCKET");
}

export async function checkSupabaseReadiness(
  client: ReadinessClient = getSupabaseAdmin(),
  bucket = storageBucket(),
): Promise<void> {
  if (bucket !== "roadwatch-reports") {
    throw new Error("The configured Supabase Storage bucket is not roadwatch-reports.");
  }

  const [tableChecks, bucketCheck] = await Promise.all([
    Promise.all(
      readinessTables.map(async ([table, column]) => {
        const { error } = await client
          .from(table)
          .select(column, { head: true, count: "exact" });
        if (error) {
          throw new Error(`Supabase table "${table}" is unavailable: ${error.message}`);
        }
      }),
    ),
    client.storage.getBucket(bucket),
  ]);

  throwOnError(bucketCheck.error);
  if (!bucketCheck.data) {
    throw new Error("The configured Supabase Storage bucket was not found.");
  }
  if (bucketCheck.data.public) {
    throw new Error("The configured Supabase Storage bucket must be private.");
  }
}

export function createSupabaseStore(
  client: SupabaseClient = getSupabaseAdmin(),
): RoadWatchStore {
  const storage = () => client.storage.from(storageBucket());

  return {
    async consumeRateLimit(key, limit, windowSeconds) {
      const { data, error } = await client.rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      throwOnError(error);
      return data === true;
    },

    async createSignedUpload(path) {
      const { data, error } = await storage().createSignedUploadUrl(path, {
        upsert: false,
      });
      throwOnError(error);
      if (!data?.token) {
        throw new Error("Supabase did not return a signed upload token.");
      }
      return data.token;
    },

    async createSignedDownload(path, expiresIn) {
      const { data, error } = await storage().createSignedUrl(path, expiresIn);
      throwOnError(error);
      if (!data?.signedUrl) {
        throw new Error("Supabase did not return a signed download URL.");
      }
      return data.signedUrl;
    },

    async createUploadTicket(ticket) {
      const { error } = await client.from("report_upload_tickets").insert(ticket);
      throwOnError(error);
    },

    async claimUploadTicket(id, uploaderHash, now) {
      const { data, error } = await client
        .from("report_upload_tickets")
        .update({ consumed_at: now })
        .eq("id", id)
        .eq("uploader_hash", uploaderHash)
        .is("consumed_at", null)
        .gt("expires_at", now)
        .select("*")
        .maybeSingle();
      throwOnError(error);
      return data as UploadTicket | null;
    },

    async deleteUploadTicket(id) {
      const { error } = await client
        .from("report_upload_tickets")
        .delete()
        .eq("id", id);
      throwOnError(error);
    },

    async uploadPhoto(path, bytes) {
      const { error } = await storage().upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "3600",
      });
      throwOnError(error);
    },

    async downloadPhoto(path) {
      const { data, error } = await storage().download(path);
      if (error) {
        if (error.message.toLowerCase().includes("not found")) return null;
        throw new Error(error.message);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async removePhoto(path) {
      const { error } = await storage().remove([path]);
      throwOnError(error);
    },

    async insertReport(report) {
      const { data, error } = await client
        .from("community_reports")
        .insert(report)
        .select("*")
        .single();
      throwOnError(error);
      return data as ReportRow;
    },

    async listReports(limit) {
      const { data, error, count } = await client
        .from("community_reports")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(limit);
      throwOnError(error);
      return { items: (data ?? []) as ReportRow[], total: count ?? 0 };
    },

    async findReport(id) {
      const { data, error } = await client
        .from("community_reports")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      throwOnError(error);
      return data as ReportRow | null;
    },

    async insertEvent(event) {
      const { data, error } = await client
        .from("events")
        .insert(event)
        .select("*")
        .single();
      throwOnError(error);
      return data as EventRow;
    },

    async listEvents(severity, limit) {
      let query = client.from("events").select("*", { count: "exact" });
      if (severity) query = query.eq("severity", severity);
      const { data, error, count } = await query
        .order("timestamp", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      throwOnError(error);
      return { items: (data ?? []) as EventRow[], total: count ?? 0 };
    },

    async findEvent(id) {
      const { data, error } = await client
        .from("events")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      throwOnError(error);
      return data as EventRow | null;
    },

    async clearSimulatedEvents() {
      const { error } = await client.from("events").delete().eq("simulated", true);
      throwOnError(error);
    },

    async insertDeviceEvent(event) {
      const { data, error } = await client
        .from("device_events")
        .insert(event)
        .select("*")
        .single();
      if (!error) {
        return { event: data as DeviceEventRow, duplicate: false, conflict: false };
      }
      if (error.code !== "23505") throw new Error(error.message);

      const { data: existing, error: lookupError } = await client
        .from("device_events")
        .select("*")
        .eq("event_id", event.event_id)
        .maybeSingle();
      throwOnError(lookupError);
      if (!existing) throw new Error("Duplicate device event could not be retrieved.");
      const row = existing as DeviceEventRow;
      return {
        event: row,
        duplicate: row.device_id === event.device_id,
        conflict: row.device_id !== event.device_id,
      };
    },

    async listDeviceEvents(limit) {
      const { data, error, count } = await client
        .from("device_events")
        .select("*", { count: "exact" })
        .order("timestamp", { ascending: false })
        .limit(limit);
      throwOnError(error);
      return { items: (data ?? []) as DeviceEventRow[], total: count ?? 0 };
    },

    async upsertTelemetry(row) {
      const { error } = await client
        .from("device_telemetry")
        .upsert(row, { onConflict: "device_id" });
      throwOnError(error);
    },

    async latestTelemetry() {
      const { data, error } = await client
        .from("device_telemetry")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throwOnError(error);
      return data as TelemetryRow | null;
    },
  };
}
