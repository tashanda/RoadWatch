import { ApiError, isRecord, jsonError, queryLimit, reportError, validEventType, validSeverity, validatedTimestamp, type StoreFactory } from "./http";
import { createSupabaseStore, type EventRow, type RoadWatchStore } from "./supabase-store";

function parseEvent(value: unknown): Omit<EventRow, "id"> {
  if (!isRecord(value)) throw new ApiError(422, "Event details are invalid.");
  if (
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    throw new ApiError(422, "Event coordinates are invalid.");
  }
  if (!validSeverity(value.severity)) {
    throw new ApiError(422, "Severity must be low, medium, or high.");
  }
  if (!validEventType(value.event_type)) {
    throw new ApiError(422, "Event type is not supported.");
  }
  const timestamp = validatedTimestamp(value.timestamp);
  if (!timestamp) throw new ApiError(422, "Timestamp must include a valid timezone.");
  if (value.simulated !== undefined && typeof value.simulated !== "boolean") {
    throw new ApiError(422, "Simulated must be a boolean.");
  }
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    severity: value.severity,
    timestamp,
    event_type: value.event_type,
    simulated: value.simulated === true,
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

export async function createEvent(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  return withStore("Could not save sensor event", storeFactory, async (store) => {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiError(400, "Event details must be valid JSON.");
    }
    const event = parseEvent(input);
    return Response.json(await store.insertEvent(event), { status: 201 });
  });
}

export async function listEvents(
  request: Request,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = queryLimit(url);
  if (limit === null) return jsonError(new ApiError(422, "Limit must be between 1 and 500."));
  const severityValue = url.searchParams.get("severity");
  if (severityValue && !validSeverity(severityValue)) {
    return jsonError(new ApiError(422, "Severity must be low, medium, or high."));
  }
  return withStore("Could not list sensor events", storeFactory, async (store) => {
    return Response.json(
      await store.listEvents((severityValue as "low" | "medium" | "high" | null) ?? null, limit),
    );
  });
}

export async function getEvent(
  id: string,
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return jsonError(new ApiError(422, "Event ID must be a positive integer."));
  }
  return withStore("Could not retrieve sensor event", storeFactory, async (store) => {
    const event = await store.findEvent(Number(id));
    if (!event) throw new ApiError(404, "Event not found");
    return Response.json(event);
  });
}

export async function clearSimulatedEvents(
  storeFactory: StoreFactory = createSupabaseStore,
): Promise<Response> {
  return withStore("Could not clear simulated sensor events", storeFactory, async (store) => {
    await store.clearSimulatedEvents();
    return new Response(null, { status: 204 });
  });
}
