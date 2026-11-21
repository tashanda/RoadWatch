import { describe, expect, it } from "vitest";

import {
  checkSupabaseReadiness,
  type ReadinessClient,
} from "./supabase-store";

const expectedTables = [
  "events",
  "community_reports",
  "device_events",
  "report_upload_tickets",
  "api_rate_limits",
];

function makeReadinessClient(options: {
  failedTable?: string;
  bucketPublic?: boolean;
  bucketError?: { message: string } | null;
  bucketExists?: boolean;
} = {}) {
  const queriedTables: string[] = [];
  const bucketNames: string[] = [];
  const client: ReadinessClient = {
    from(table) {
      return {
        select() {
          queriedTables.push(table);
          return Promise.resolve({
            error:
              table === options.failedTable
                ? { message: "table check failed" }
                : null,
          });
        },
      };
    },
    storage: {
      getBucket(id) {
        bucketNames.push(id);
        return Promise.resolve({
          data:
            options.bucketExists === false
              ? null
              : { public: options.bucketPublic ?? false },
          error: options.bucketError ?? null,
        });
      },
    },
  };

  return { client, queriedTables, bucketNames };
}

describe("checkSupabaseReadiness", () => {
  it("checks all application tables and confirms the reports bucket is private", async () => {
    const { client, queriedTables, bucketNames } = makeReadinessClient();

    await expect(
      checkSupabaseReadiness(client, "roadwatch-reports"),
    ).resolves.toBeUndefined();

    expect(queriedTables.sort()).toEqual(expectedTables.sort());
    expect(bucketNames).toEqual(["roadwatch-reports"]);
  });

  it("fails when an application table is unavailable", async () => {
    const { client } = makeReadinessClient({ failedTable: "events" });

    await expect(
      checkSupabaseReadiness(client, "roadwatch-reports"),
    ).rejects.toThrow('Supabase table "events" is unavailable: table check failed');
  });

  it("fails when the reports bucket is public or missing", async () => {
    const publicBucket = makeReadinessClient({ bucketPublic: true });
    await expect(
      checkSupabaseReadiness(publicBucket.client, "roadwatch-reports"),
    ).rejects.toThrow("must be private");

    const missingBucket = makeReadinessClient({ bucketExists: false });
    await expect(
      checkSupabaseReadiness(missingBucket.client, "roadwatch-reports"),
    ).rejects.toThrow("was not found");
  });

  it("rejects a bucket configuration that differs from the required bucket", async () => {
    const { client, queriedTables, bucketNames } = makeReadinessClient();

    await expect(
      checkSupabaseReadiness(client, "unexpected-bucket"),
    ).rejects.toThrow("is not roadwatch-reports");
    expect(queriedTables).toEqual([]);
    expect(bucketNames).toEqual([]);
  });
});
