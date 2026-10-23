import { readFileSync } from "node:fs";
import { activityUpsert, sheetChangeEvent, validationIssue, agentOutput, drillConfig, importReport, apiError, sheetMapping } from "../src/domain/contracts";
import { check, summary } from "./helpers";
const load = (f: string) => JSON.parse(readFileSync(`docs/examples/${f}`, "utf8"));
(async () => {
  console.log("Ejemplos JSON del brief (los mismos archivos que se incrustan en el documento):");
  const cases: [string, { parse: (x: unknown) => unknown }][] = [["activity_upsert.json", activityUpsert], ["sheet_change_event.json", sheetChangeEvent], ["validation_issue.json", validationIssue], ["agent_output.json", agentOutput], ["drill_config.json", drillConfig], ["import_report.json", importReport], ["api_error.json", apiError], ["sheet_mapping.json", sheetMapping]];
  for (const [f, schema] of cases) await check(`${f} cumple su contrato zod`, () => { schema.parse(load(f)); });
  summary();
})();
