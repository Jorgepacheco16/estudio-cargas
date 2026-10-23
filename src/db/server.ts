import { createDb, type Db } from "./client";

/** Una sola conexión (rol app_user, pooler de Supabase) por proceso. Nunca usa la conexión de migraciones ni la clave de servicio. */
const g = globalThis as unknown as { __appDb?: Db };

export function getDb(): Db {
  if (g.__appDb) return g.__appDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  g.__appDb = createDb(url, 3).db;
  return g.__appDb;
}
