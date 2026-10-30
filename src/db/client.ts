import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Conexión del servidor. `prepare:false` es obligatorio con el pooler de Supabase en modo transacción (puerto 6543). */
export function createDb(url: string, max = 5) {
  const client = postgres(url, { prepare: false, max, idle_timeout: 20 });
  return { client, db: drizzle(client, { schema }) };
}

const claimsSchema = z.object({ sub: z.string().uuid(), email: z.string().email().max(254).optional() });

/**
 * Ejecuta `run` con RLS REAL: dentro de UNA transacción fija las claims del JWT y cambia al rol `authenticated`
 * (SET LOCAL ROLE). Al terminar la transacción ambos valores desaparecen, por lo que no se filtran a la
 * siguiente petición que reutilice la conexión. La conexión debe usar un rol SIN BYPASSRLS y que no sea dueño de las tablas.
 */
export async function withRls<T>(db: Db, claims: { sub: string; email?: string }, run: (tx: Tx) => Promise<T>): Promise<T> {
  const { sub, email } = claimsSchema.parse(claims); // el correo solo lo usa la función que acepta invitaciones (private.redeem_invitation)
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: "authenticated", ...(email ? { email } : {}) })}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return run(tx);
  });
}
