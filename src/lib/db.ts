// Postgres client (Supabase). Optional: without DATABASE_URL the app keeps the in-memory + .cache path.
// Server-only; imported lazily so the no-database path never loads the driver.
import postgres from "postgres";

export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

const g = globalThis as typeof globalThis & { __radarSql?: postgres.Sql };

/** One lazily-created client per process (survives dev hot reload). */
export function sql(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!g.__radarSql) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    g.__radarSql = postgres(url, {
      ssl: local ? false : "require", // Supabase requires TLS; a local test database has none
      prepare: false, // required by Supabase's transaction pooler (port 6543)
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
  }
  return g.__radarSql;
}

/** Close the client (scripts only, so the process can exit). */
export async function closeDb() {
  if (g.__radarSql) {
    await g.__radarSql.end({ timeout: 5 });
    g.__radarSql = undefined;
  }
}
