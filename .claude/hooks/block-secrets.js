/**
 * Hook PreToolUse de Claude Code (matcher Write|Edit): bloquea escrituras que contengan secretos o que apunten a archivos de entorno.
 * Recibe el evento como JSON por la entrada estándar. Salida 2 = BLOQUEAR y avisar a Claude; salida 0 = permitir.
 * Sin dependencias: funciona igual con CommonJS o con módulos ES.
 */
const PATHS_BLOQUEADAS = [/(^|[\\/])\.env(\.(?!example$)[^\\/]*)?$/i, /service-account[^\\/]*\.json$/i, /\.pem$/i, /id_(rsa|ed25519)$/i];

/** Patrones de secretos (formato de los proveedores usados). Se arman por partes para que este archivo no dispare a los escáneres. */
const PATRONES = [
  ["clave de Anthropic", new RegExp("sk-ant-" + "[A-Za-z0-9_-]{20,}")],
  ["token de Supabase (sbp_)", new RegExp("sbp" + "_[A-Za-z0-9]{20,}")],
  ["clave secreta de Supabase", new RegExp("sb_secret" + "_[A-Za-z0-9_-]{16,}")],
  ["token de Vercel", new RegExp("vcp" + "_[A-Za-z0-9]{20,}")],
  ["token de GitHub", new RegExp("gh[pousr]" + "_[A-Za-z0-9]{30,}")],
  ["JWT (posible service_role)", new RegExp("eyJ" + "[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}")],
  ["llave privada", new RegExp("-----BEGIN [A-Z ]*PRIVATE" + " KEY-----")],
  ["cadena de conexión con contraseña", new RegExp("postgres(?:ql)?://[^\\s:/@]+:[^\\s@]{6,}@(?!localhost|127\\.0\\.0\\.1)")],
  ["JSON de cuenta de servicio de Google", new RegExp("\"private_key\"\\s*:\\s*\"-----BEGIN")],
];

function revisar(evento) {
  const entrada = (evento && evento.tool_input) || {};
  const ruta = String(entrada.file_path || entrada.path || "");
  for (const re of PATHS_BLOQUEADAS) if (re.test(ruta)) return `Bloqueado: no se escriben archivos de entorno ni llaves (${ruta}). Use variables de entorno y .env.example sin valores.`;
  const texto = [entrada.content, entrada.new_string, entrada.new_str].filter((x) => typeof x === "string").join("\n");
  for (const [nombre, re] of PATRONES) if (re.test(texto)) return `Bloqueado: el contenido parece incluir un secreto (${nombre}). Los secretos solo van en variables de entorno, nunca en el repositorio.`;
  return null;
}

if (typeof module !== "undefined" && module.exports) module.exports = { revisar };

if (typeof require === "undefined" || require.main === module) {
  let datos = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { datos += c; });
  process.stdin.on("end", () => {
    let evento;
    try { evento = JSON.parse(datos || "{}"); } catch { process.stderr.write("Hook de secretos: entrada ilegible; se bloquea por seguridad.\n"); process.exit(2); }
    const motivo = revisar(evento);
    if (motivo) { process.stderr.write(motivo + "\n"); process.exit(2); }
    process.exit(0);
  });
}
