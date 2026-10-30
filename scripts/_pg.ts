import postgres from "postgres";
import { readFileSync } from "node:fs";
const sql = postgres("postgres://postgres:pg_admin@127.0.0.1:5432/postgres", { max: 1, onnotice: () => {} });
const files = ["sql/local_bootstrap.sql", "drizzle/0000_init.sql", "sql/0001_rls.sql", "drizzle/0001_weeks_per_month_precision.sql", "drizzle/0002_sheet_connections_actor.sql", "sql/0002_sheets.sql", "drizzle/0003_deviation_thresholds.sql", "sql/0003_history.sql", "drizzle/0004_position_shifts.sql", "sql/0004_shifts.sql", "drizzle/0005_shift_days.sql", "drizzle/0006_position_operation.sql", "drizzle/0007_diagnostico_centro_operaciones.sql", "drizzle/0008_position_shift_type.sql", "drizzle/0009_daily_work_hours.sql", "drizzle/0010_roles_usuarios.sql", "sql/0005_roles_rls.sql"];
(async () => {
  for (const f of files) {
    try { await sql.unsafe(readFileSync(f, "utf8").replace(/--> statement-breakpoint/g, "")); console.log("OK ", f); }
    catch (e) { console.log("ERR", f, "→", (e as Error).message); break; }
  }
  await sql.end();
})();
