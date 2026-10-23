/** Se instala UNA vez por hoja: Extensiones → Apps Script → Activadores → onEditInstalled (al editar) y onChangeInstalled (al cambiar). */
const WEBHOOK_URL = 'https://TU-DOMINIO.vercel.app/api/sheets/webhook';
function props_() { return PropertiesService.getScriptProperties(); }   // WEBHOOK_SECRET se guarda aquí, no en el código
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join(''); }
function post_(payload) {
  var ts = Date.now(); var body = JSON.stringify(payload);
  var sig = hex_(Utilities.computeHmacSha256Signature(ts + '.' + body, props_().getProperty('WEBHOOK_SECRET')));
  UrlFetchApp.fetch(WEBHOOK_URL, { method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'x-timestamp': String(ts), 'x-signature': sig } });
}
function onEditInstalled(e) {
  var r = e.range;
  post_({ eventId: Utilities.getUuid(), spreadsheetId: e.source.getId(), sheetName: r.getSheet().getName(), kind: 'edit',
    range: { row: r.getRow(), col: r.getColumn(), rows: r.getNumRows(), cols: r.getNumColumns() },
    values: r.getValues().slice(0, 500), editedAt: new Date().toISOString() });
}
function onChangeInstalled(e) {   // inserción/borrado de filas o columnas, cambios de estructura
  post_({ eventId: Utilities.getUuid(), spreadsheetId: e.source.getId(), sheetName: e.source.getActiveSheet().getName(), kind: 'change',
    range: { row: 1, col: 1, rows: 1, cols: 1 }, values: [], editedAt: new Date().toISOString() });
}
