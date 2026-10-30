import { sheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

/** Cuenta de servicio con acceso SOLO a las hojas compartidas con ella. El JSON de la clave vive en variables de entorno del servidor. */
export function sheetsClient() {
  const auth = new GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}"), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return sheets({ version: "v4", auth });
}
/** app → hoja. valueInputOption RAW evita que un texto que empiece por "=" se ejecute como fórmula (inyección de fórmulas). */
export async function pushCells(spreadsheetId: string, updates: { range: string; values: (string | number | boolean | null)[][] }[]) {
  const api = sheetsClient();
  const res = await api.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: updates } });
  return res.data.totalUpdatedCells ?? 0;
}
/** Escribe FÓRMULAS (USER_ENTERED). Solo para las fórmulas constantes que la app mantiene en el libro (D-89): nunca con texto que venga de una persona. */
export async function pushFormulas(spreadsheetId: string, updates: { range: string; values: string[][] }[]) {
  const res = await sheetsClient().spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: updates } });
  return res.data.totalUpdatedCells ?? 0;
}
/** Lee las fórmulas tal como están escritas en la hoja (no sus resultados). */
export async function readFormulas(spreadsheetId: string, range: string) {
  const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "FORMULA" });
  return res.data.values ?? [];
}
/** hoja → app (lectura de reconciliación; la hoja puede cambiar sin avisar si falla el webhook). */
export async function readRange(spreadsheetId: string, range: string) {
  const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "UNFORMATTED_VALUE" });
  return res.data.values ?? [];
}
