import { expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Usuarios, roles e invitaciones (D-91) en un navegador de verdad, con la autenticación SIMULADA (tests/support/mock-auth.ts) y una base de datos de pruebas:
 * el Super usuario crea un rol, invita a una persona, ella crea su clave y entra, ve solo lo que su rol permite, y el Super usuario la ve «como ella» (solo lectura).
 * Corre en el trabajo e2e-usuarios del CI (ver ci.yml); localmente exige la autenticación simulada, la siembra (e2e/support/seed-usuarios.ts) y la app compilada con
 * NEXT_PUBLIC_SUPABASE_URL apuntando a la autenticación simulada.
 */
test.describe.configure({ mode: "serial" });

const listo = async (p: Page, name: string) => { await p.getByRole("heading", { name }).first().waitFor(); await p.waitForLoadState("networkidle"); };
let admin: Page, ana: Page, link = "", anaClave = "Clave-nueva-de-Ana-9";
const MOCK = process.env.MOCK_AUTH_URL ?? "http://127.0.0.1:54321";
/** Cuántas veces la autenticación simulada validó una sesión (ver tests/support/mock-auth.ts). */
const validaciones = async () => ((await (await fetch(`${MOCK}/__stats`)).json()) as { userChecks: number }).userChecks;

async function abrir(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "es-CO", baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100" });
  return ctx.newPage();
}

test("el Super usuario entra y ve «Usuarios y roles»", async ({ browser }) => {
  admin = await abrir(browser);
  await admin.goto("/ingreso");
  await admin.fill("#u-email", "admin@prueba.co");
  await admin.fill("#u-pass", "Clave-de-admin-1");
  await admin.getByRole("button", { name: "Entrar", exact: true }).click();
  await admin.waitForURL((u) => u.pathname !== "/ingreso");
  await admin.goto("/usuarios");
  await listo(admin, "Usuarios y roles");
  await expect(admin.getByRole("link", { name: "Usuarios y roles" }).first()).toBeVisible();
  await expect(admin.getByText("Super usuario").first()).toBeVisible();
});

test("crea un rol: las dependencias suben a Lectura y se avisan", async () => {
  await admin.goto("/usuarios/roles/nuevo");
  await listo(admin, "Nuevo rol");
  await admin.fill("#rol-nombre", "Capturista de actividades");
  await admin.getByRole("radio", { name: "Actividades: Edición" }).check();
  await admin.getByRole("button", { name: "Guardar rol" }).click();
  await admin.waitForURL(/vista=roles/);
  await expect(admin.locator(".banner").first()).toContainText("Rol guardado");
  await expect(admin.locator(".banner").first()).toContainText("Cargos y dotación");
});

test("invita a una persona con rol y áreas: el enlace se muestra una sola vez", async () => {
  await admin.goto("/usuarios?vista=personas");
  await listo(admin, "Personas con acceso");
  await admin.fill("#inv-correo", "ana@prueba.co");
  await admin.selectOption("#inv-rol", (await admin.locator("#inv-rol option", { hasText: "Capturista" }).getAttribute("value"))!);
  await admin.getByRole("radio", { name: "Solo estas áreas" }).check();
  await admin.getByRole("checkbox", { name: "Cajas", exact: true }).check();
  await admin.getByRole("button", { name: "Crear invitación y enlace" }).click();
  link = await admin.getByLabel("Enlace de invitación").inputValue();
  expect(link).toMatch(/\/invitacion\/[A-Za-z0-9_-]{40,}$/);
});

test("la persona abre el enlace, crea su clave y entra; el enlace no sirve dos veces", async ({ browser }) => {
  ana = await abrir(browser);
  const path = new URL(link).pathname;
  await ana.goto(path);
  await listo(ana, "Bienvenido");
  await expect(ana.getByText("ana@prueba.co").first()).toBeVisible();
  await ana.fill("#inv-clave", "Clave-de-Ana-123");
  await ana.fill("#inv-clave2", "Otra-clave-distinta-1");
  await ana.getByRole("button", { name: "Crear mi clave y entrar" }).click();
  await expect(ana.getByText("Las dos claves no coinciden.")).toBeVisible();
  await ana.fill("#inv-clave", "Clave-de-Ana-123");
  await ana.fill("#inv-clave2", "Clave-de-Ana-123");
  await ana.getByRole("button", { name: "Crear mi clave y entrar" }).click();
  await ana.waitForURL((u) => !u.pathname.startsWith("/invitacion"));
  const otra = await abrir(browser);
  await otra.goto(path);
  await expect(otra.getByText("Esta invitación no sirve")).toBeVisible();
});

test("la persona ve y edita lo que su rol permite, y nada más", async () => {
  await ana.goto("/actividades");
  await listo(ana, "Actividades");
  await expect(ana.getByText("E-1").first()).toBeVisible();
  await expect(ana.getByText("E-2")).toHaveCount(0); // la actividad de Domicilios no es de su área
  await expect(ana.getByText(/Trabaja solo con el área/)).toContainText("Cajas");
  await expect(ana.getByRole("link", { name: "+ Agregar registro" }).first()).toBeVisible();
  const menu = await ana.locator("nav.nav").innerText();
  expect(menu).toContain("Cargos y dotación");
  expect(menu).not.toContain("Usuarios y roles");
  expect(menu).not.toContain("Integraciones");
  expect(menu).not.toContain("Riesgos");
  await ana.goto("/diagnostico/riesgos");
  await ana.waitForURL(/sin-acceso/);
  await expect(ana.getByRole("heading", { name: "Sin acceso" })).toBeVisible();
  await ana.goto("/usuarios");
  await ana.waitForURL(/sin-acceso/);
  await ana.goto("/cargos");
  await listo(ana, "Cargos");
  await expect(ana.getByRole("link", { name: "+ Agregar registro" })).toHaveCount(0); // Lectura: sin botón de agregar
});

test("«Estudio»: un rol sin acceso no lo ve ni lo abre; con Lectura lo ve y cambia de estudio pero no puede crear estudios nuevos", async () => {
  const enlaceEstudio = () => ana.locator("nav.nav").getByRole("link", { name: "Estudio", exact: true });
  // el rol «Capturista de actividades» se creó sin tocar «Estudio»: Sin acceso
  await ana.goto("/actividades");
  await listo(ana, "Actividades");
  await expect(enlaceEstudio()).toHaveCount(0);
  await ana.goto("/estudio");
  await ana.waitForURL((u) => u.pathname === "/");
  // el Super usuario le da Lectura en «Estudio»
  await admin.goto("/usuarios?vista=roles");
  await listo(admin, "Usuarios y roles");
  await admin.locator("tr", { hasText: "Capturista de actividades" }).getByRole("link", { name: "Editar" }).click();
  await admin.getByRole("radio", { name: "Estudio: Lectura" }).check();
  await admin.getByRole("button", { name: "Guardar rol" }).click();
  await admin.waitForURL(/vista=roles/);
  await expect(admin.locator(".banner").first()).toContainText("Rol guardado");
  // ahora ve la ventana y puede cambiar de estudio, pero no hay forma de crear uno nuevo
  await ana.goto("/actividades");
  await listo(ana, "Actividades");
  await expect(enlaceEstudio()).toBeVisible();
  await ana.goto("/estudio");
  await listo(ana, "Estudio");
  await expect(ana.locator("#estudio-id")).toBeVisible();
  await expect(ana.getByRole("button", { name: "Usar este estudio" })).toBeVisible();
  await expect(ana.locator("#estudio-nombre")).toHaveCount(0);
  await expect(ana.getByRole("button", { name: "Crear estudio" })).toHaveCount(0);
  await expect(ana.getByText(/no crear estudios nuevos/)).toBeVisible();
  await ana.goto("/cuenta"); // y «Mi cuenta» muestra su nivel
  await listo(ana, "Mi cuenta");
  await expect(ana.locator("tr", { hasText: "Estudio" }).filter({ hasText: "Lectura" }).first()).toBeVisible();
});

test("«Resultados» (D-100): solo el Super usuario lo ve; al habilitarlo en un rol, esa persona ve Dotación requerida (solo sus áreas) y no el Agente de IA sin su propio permiso", async () => {
  // El Super usuario: el grupo está en el menú con sus dos subsecciones, la dotación se calcula por cargo y por área y el Agente de IA vive dentro del grupo
  await admin.goto("/resultados/dotacion");
  await listo(admin, "Dotación requerida");
  await expect(admin.getByRole("button", { name: "Resultados" })).toHaveAttribute("aria-expanded", "true");
  await expect(admin.getByRole("group", { name: "Resultados" }).getByRole("link")).toHaveText(["Dotación requerida", "Reparto semanal", "Informe", "Agente de IA"]);
  for (const t of ["Personas que hay", "Personas necesarias", "Brecha", "Cargos sin cifra"]) await expect(admin.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Por área" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Por cargo" })).toBeVisible();
  await expect(admin.locator("tr", { hasText: "Cajero" }).first()).toBeVisible();
  await expect(admin.locator("tr", { hasText: "Auxiliar" }).first()).toBeVisible();
  const axe = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  const [d] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(d.suggestedFilename()).toMatch(/dotacion.*\.xlsx$/);
  // Reparto semanal: una semana común y otra con periódicas, por persona y día, con el tiempo de cada actividad; se descarga a Excel
  await admin.goto("/resultados/reparto");
  await listo(admin, "Reparto semanal");
  await expect(admin.getByRole("heading", { name: "Cajero" })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Semana común" }).first()).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Semana con actividades periódicas" }).first()).toBeVisible();
  await expect(admin.locator("td", { hasText: /^Persona 1$/ }).first()).toBeVisible();
  await expect(admin.getByRole("columnheader", { name: "Lunes" }).first()).toBeVisible();
  await expect(admin.locator(".banner", { hasText: /sin tipo registrado se reparte/ }).first()).toBeVisible();
  // Detalle del día (D-103): pulsar la celda de una persona abre sus tareas en orden, con su tiempo y SIN horas del día; el orden se puede cambiar con las flechas (solo en la vista) y restablecer; se cierra con Esc
  const tarjeta = admin.locator('section[aria-label="Reparto de Cajero"]');
  await tarjeta.getByRole("button", { name: /Ver las tareas de la persona 1 el lunes/i }).first().click();
  const dia = admin.getByRole("dialog", { name: /Persona 1 · Lunes/ });
  await expect(dia).toBeVisible();
  for (const h of ["#", "Tarea", "Tiempo", "Orden"]) await expect(dia.getByRole("columnheader", { name: h })).toBeVisible();
  await expect(dia.getByText(/\b\d{1,2}:\d{2}\b/)).toHaveCount(0); // ninguna hora del día
  await expect(dia.getByText(/Trabajo del día/)).toBeVisible();
  const filas = dia.locator("tbody tr");
  await expect(filas.nth(0)).toContainText("E-1");
  await expect(filas.nth(1)).toContainText("E-3");
  await expect(dia.getByRole("button", { name: "Subir E-1" })).toBeDisabled(); // extremo: no se puede subir la primera
  await dia.getByRole("button", { name: "Bajar E-1" }).click();
  await expect(filas.nth(0)).toContainText("E-3");
  await expect(filas.nth(1)).toContainText("E-1");
  await expect(dia.getByRole("button", { name: "Bajar E-1" })).toBeDisabled();
  await expect(dia.getByRole("status")).toContainText("ahora es la tarea 2 de");
  await dia.getByRole("button", { name: "Restablecer el orden sugerido" }).click();
  await expect(filas.nth(0)).toContainText("E-1");
  await expect(dia.getByRole("button", { name: "Restablecer el orden sugerido" })).toHaveCount(0);
  await dia.getByRole("button", { name: "Bajar E-1" }).click();
  await dia.getByRole("button", { name: "Guardar este orden" }).click(); // D-104: lo guarda quien tiene Resultados en Edición
  await expect(dia.getByRole("status")).toContainText("Orden guardado");
  await expect(dia.getByRole("button", { name: "Guardar este orden" })).toBeDisabled(); // nada pendiente por guardar
  const axeDia = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axeDia.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await admin.keyboard.press("Escape");
  await expect(dia).toBeHidden();
  const celdaLunes = tarjeta.getByRole("button", { name: /Ver las tareas de la persona 1 el lunes/i }).first();
  await expect(celdaLunes.locator(".dc-line").first()).toContainText("E-3");
  await expect(celdaLunes).toContainText("orden guardado");
  // al recargar, el orden sigue guardado (queda en la base, no solo en la pantalla)
  await admin.goto("/resultados/reparto");
  await listo(admin, "Reparto semanal");
  await admin.locator('section[aria-label="Reparto de Cajero"]').getByRole("button", { name: /Ver las tareas de la persona 1 el lunes.*con orden guardado/i }).first().click();
  const diaGuardado = admin.getByRole("dialog", { name: /Persona 1 · Lunes/ });
  await expect(diaGuardado.locator("tbody tr").nth(0)).toContainText("E-3");
  await expect(diaGuardado.getByText(/Este día tiene un orden guardado/)).toBeVisible();
  await admin.keyboard.press("Escape");
  await expect(diaGuardado).toBeHidden();
  const axeReparto = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axeReparto.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  const [dr] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(dr.suggestedFilename()).toMatch(/reparto.*\.xlsx$/);
  await admin.goto("/agente"); // la dirección anterior del Agente de IA lleva a su nueva sección
  await admin.waitForURL(/\/resultados\/agente/);
  await expect(admin.getByRole("heading", { name: "Ejecutar análisis" })).toBeVisible();
  // Ana, con un rol que no tiene «Resultados»: ni el grupo en el menú ni las direcciones
  await ana.goto("/actividades");
  await listo(ana, "Actividades");
  await expect(ana.getByRole("button", { name: "Resultados" })).toHaveCount(0);
  for (const ruta of ["/resultados/dotacion", "/resultados/reparto", "/resultados/agente", "/agente"]) { await ana.goto(ruta); await ana.waitForURL(/sin-acceso/); }
  for (const vista of ["dotacion", "reparto"]) expect((await ana.request.get(`/api/export/${vista}?format=csv&modo=real`)).status(), `descarga de ${vista} sin el permiso`).toBe(403);
  // El Super usuario habilita «Resultados» (Lectura) en el rol de Ana desde «Usuarios y roles»
  await admin.goto("/usuarios?vista=roles");
  await listo(admin, "Usuarios y roles");
  await admin.locator("tr", { hasText: "Capturista de actividades" }).getByRole("link", { name: "Editar" }).click();
  await admin.getByRole("radio", { name: "Resultados: Lectura" }).check();
  await admin.getByRole("button", { name: "Guardar rol" }).click();
  await admin.waitForURL(/vista=roles/);
  await expect(admin.locator(".banner").first()).toContainText("Rol guardado");
  // Ana ahora ve el grupo y la dotación de SU área; el Agente de IA sigue sin aparecer (necesita su propio permiso y todas las áreas)
  await ana.goto("/actividades");
  await listo(ana, "Actividades");
  await expect(ana.getByRole("button", { name: "Resultados" })).toBeVisible();
  await ana.goto("/resultados/dotacion");
  await listo(ana, "Dotación requerida");
  await expect(ana.locator("tr", { hasText: "Cajero" }).first()).toBeVisible();
  await expect(ana.locator("tr", { hasText: "Auxiliar" })).toHaveCount(0); // otra área
  await expect(ana.getByRole("group", { name: "Resultados" }).getByRole("link", { name: "Agente de IA" })).toHaveCount(0);
  await ana.goto("/resultados/reparto");
  await listo(ana, "Reparto semanal");
  await expect(ana.getByRole("heading", { name: "Cajero" })).toBeVisible();
  await expect(ana.getByRole("heading", { name: "Auxiliar" })).toHaveCount(0); // otra área
  // Ana (Lectura en Resultados) ve el orden que guardó el Super usuario, puede probar otro, pero no guardarlo
  await ana.locator('section[aria-label="Reparto de Cajero"]').getByRole("button", { name: /Ver las tareas de la persona 1 el lunes.*con orden guardado/i }).first().click();
  const diaAna = ana.getByRole("dialog", { name: /Persona 1 · Lunes/ });
  await expect(diaAna.locator("tbody tr").nth(0)).toContainText("E-3");
  await expect(diaAna.getByRole("button", { name: "Guardar este orden" })).toHaveCount(0);
  await expect(diaAna.getByText(/pero no guardarlos/)).toBeVisible();
  await diaAna.getByRole("button", { name: "Subir E-1" }).click();
  await expect(diaAna.locator("tbody tr").nth(0)).toContainText("E-1");
  await ana.keyboard.press("Escape");
  for (const vista of ["dotacion", "reparto"]) expect((await ana.request.get(`/api/export/${vista}?format=csv&modo=real`)).status(), `descarga de ${vista} con el permiso`).toBe(200);
  await ana.goto("/resultados/agente");
  await ana.waitForURL(/sin-acceso/);
  // el texto del informe resume todo el estudio: Ana, limitada a algunas áreas, ve el tablero pero no el texto
  await ana.goto("/resultados/informe");
  await listo(ana, "Informe de resultados");
  await expect(ana.getByText("su acceso está limitado a algunas áreas")).toBeVisible();
  await expect(ana.getByRole("heading", { name: "Texto del informe" })).toHaveCount(0);
  // el Super usuario quita el orden guardado para dejar todo como estaba
  await admin.goto("/resultados/reparto");
  await listo(admin, "Reparto semanal");
  await admin.locator('section[aria-label="Reparto de Cajero"]').getByRole("button", { name: /Ver las tareas de la persona 1 el lunes/i }).first().click();
  const diaQuitar = admin.getByRole("dialog", { name: /Persona 1 · Lunes/ });
  await diaQuitar.getByRole("button", { name: "Restablecer el orden sugerido" }).click();
  await diaQuitar.getByRole("button", { name: "Guardar (quitar el orden guardado)" }).click();
  await expect(diaQuitar.getByRole("status")).toContainText("Se quitó el orden guardado");
  await admin.keyboard.press("Escape");
  await expect(admin.locator('section[aria-label="Reparto de Cajero"]').getByRole("button", { name: /con orden guardado/i })).toHaveCount(0);
  // y vuelve a quedar como estaba para no afectar a las demás pruebas
  await admin.goto("/usuarios?vista=roles");
  await listo(admin, "Usuarios y roles");
  await admin.locator("tr", { hasText: "Capturista de actividades" }).getByRole("link", { name: "Editar" }).click();
  await admin.getByRole("radio", { name: "Resultados: Sin acceso" }).check();
  await admin.getByRole("button", { name: "Guardar rol" }).click();
  await admin.waitForURL(/vista=roles/);
  await ana.goto("/resultados/dotacion");
  await ana.waitForURL(/sin-acceso/);
});

test("Informe de resultados (D-105): el tablero muestra las cifras, las tres gráficas con su descripción, la calidad de los datos y el detalle; se descarga; quien no tiene Resultados no lo ve ni lo descarga", async () => {
  await admin.goto("/resultados/informe");
  await listo(admin, "Informe de resultados");
  for (const t of ["Personas que hay", "Personas necesarias", "Brecha", "Uso con periódicas", "Datos completos"]) await expect(admin.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole("img", { name: /Personas que hay y necesarias por área\./ })).toBeVisible();
  await expect(admin.getByRole("img", { name: /Uso de la capacidad actual por cargo\./ })).toBeVisible();
  await expect(admin.getByRole("img", { name: /Trabajo de la semana común y con periódicas\./ })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Calidad de los datos", exact: true })).toBeVisible();
  await expect(admin.getByRole("heading", { name: "Detalle por cargo", exact: true })).toBeVisible();
  await expect(admin.locator("tr", { hasText: "Cajero" }).first()).toBeVisible();
  await admin.getByText("Ver los datos en una tabla").click(); // los mismos datos de la gráfica, en tabla
  await expect(admin.getByRole("region", { name: "Personas por área" })).toBeVisible();
  const axeInforme = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axeInforme.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  const [di] = await Promise.all([admin.waitForEvent("download"), admin.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(di.suggestedFilename()).toMatch(/informe.*\.xlsx$/);
  // Ana, con un rol sin «Resultados»: no lo ve y la descarga se rechaza
  await ana.goto("/resultados/informe");
  await ana.waitForURL(/sin-acceso/);
  expect((await ana.request.get("/api/export/informe?format=csv&modo=real")).status()).toBe(403);
});

test("Texto del informe (D-106): el borrador sembrado se ve con sus cifras; un número inventado lo deja «requiere revisión» y bloquea aprobar; corregido, se aprueba y queda oficial", async () => {
  await admin.goto("/resultados/informe");
  await listo(admin, "Texto del informe");
  await expect(admin.getByText("Versión 1: borrador.")).toBeVisible();
  const resumen = admin.getByRole("article", { name: "Resumen ejecutivo" });
  await expect(resumen).toContainText("Cifras citadas:");
  await expect(admin.getByRole("button", { name: "Aprobar esta versión" })).toBeEnabled();
  // un número que no es una cifra de la sección: queda para revisión y no se puede aprobar
  await resumen.getByRole("button", { name: "Editar el texto" }).click();
  const original = await admin.locator("#ed-resumen").inputValue();
  await admin.locator("#ed-resumen").fill("Se necesitan 999 personas más.");
  await resumen.getByRole("button", { name: "Guardar el texto" }).click();
  await expect(resumen.getByText("Requiere revisión.")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Aprobar esta versión" })).toBeDisabled();
  // se corrige con el texto de antes: vuelve a ser válido (editada a mano) y se puede aprobar
  await resumen.getByRole("button", { name: "Editar el texto" }).click();
  await admin.locator("#ed-resumen").fill(original);
  await resumen.getByRole("button", { name: "Guardar el texto" }).click();
  await expect(resumen.getByText("Requiere revisión.")).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Aprobar esta versión" })).toBeEnabled();
  const axeTexto = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axeTexto.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await admin.getByRole("button", { name: "Aprobar esta versión" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(admin.getByText("Versión 1 aprobada", { exact: true })).toBeVisible();
  await expect(admin.getByRole("button", { name: "Aprobar esta versión" })).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Editar el texto" })).toHaveCount(0);
  // Ana, sin «Resultados», no lo ve
  await ana.goto("/resultados/informe");
  await ana.waitForURL(/sin-acceso/);
});

test("la persona escribe su nombre en «Mi cuenta» y se le ve con él (encabezado y lista de usuarios)", async () => {
  await ana.goto("/cuenta");
  await listo(ana, "Mi cuenta");
  await ana.fill("#c-nombre", "Ana Pérez");
  await ana.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(ana.getByText("Nombre guardado.")).toBeVisible();
  await expect(ana.locator(".account-mail")).toHaveText("Ana Pérez");
  await expect(ana.locator(".account-label")).toContainText("ana@prueba.co");
});

test("la persona cambia su clave en «Mi cuenta»: pide la actual y la nueva sirve para volver a entrar", async ({ browser }) => {
  const enviar = async (actual: string, nueva: string, repetir: string) => {
    await ana.goto("/cuenta");
    await listo(ana, "Mi cuenta");
    await ana.fill("#c-actual", actual);
    await ana.fill("#c-nueva", nueva);
    await ana.fill("#c-repetir", repetir);
    await ana.getByRole("button", { name: "Cambiar clave" }).click();
  };
  await enviar("Clave-equivocada-1", "Clave-nueva-de-Ana-9", "Clave-nueva-de-Ana-9");
  await expect(ana.getByText("La clave actual no es correcta.")).toBeVisible();
  await enviar("Clave-de-Ana-123", "Clave-nueva-de-Ana-9", "Clave-nueva-de-Ana-8");
  await expect(ana.getByText("Las dos claves nuevas no coinciden.")).toBeVisible();
  await enviar("Clave-de-Ana-123", "Clave-nueva-de-Ana-9", "Clave-nueva-de-Ana-9");
  await expect(ana.getByText("Clave cambiada.")).toBeVisible();
  // la clave vieja ya no entra y la nueva sí
  const otra = await abrir(browser);
  await otra.goto("/ingreso");
  await otra.fill("#u-email", "ana@prueba.co");
  await otra.fill("#u-pass", "Clave-de-Ana-123");
  await otra.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(otra.getByRole("alert")).toBeVisible();
  await otra.waitForLoadState("networkidle"); // tras el fallo la página termina de repintarse y vacía los campos: se escribe hasta que se asiente
  await otra.fill("#u-email", "ana@prueba.co"); // la página se recarga tras el fallo y vacía los campos
  await otra.fill("#u-pass", "Clave-nueva-de-Ana-9");
  await expect(otra.locator("#u-email")).toHaveValue("ana@prueba.co");
  await otra.getByRole("button", { name: "Entrar", exact: true }).click();
  await otra.waitForURL((u) => u.pathname !== "/ingreso");
  await otra.context().close();
});

test("el Super usuario ve el cuadro de permisos y usa «Ver como» (solo lectura)", async () => {
  // El Super usuario (todas las áreas) sí ve la actividad de Domicilios y no tiene la franja de áreas.
  await admin.goto("/actividades");
  await listo(admin, "Actividades");
  await expect(admin.getByText("E-2").first()).toBeVisible();
  await expect(admin.getByText(/Trabaja solo con/)).toHaveCount(0);
  await admin.goto("/usuarios?vista=permisos");
  await listo(admin, "Cuadro de permisos");
  await expect(admin.getByText("Ana Pérez").first()).toBeVisible();
  await expect(admin.getByText("ana@prueba.co").first()).toBeVisible();
  await admin.goto("/usuarios?vista=personas");
  await listo(admin, "Personas con acceso");
  await admin.locator('section[aria-label="Personas con acceso"] tr', { hasText: "ana@prueba.co" }).getByRole("button", { name: "Ver como" }).click();
  await admin.waitForURL((u) => u.pathname === "/");
  await expect(admin.getByText(/Está viendo la aplicación como/)).toBeVisible();
  const menu = await admin.locator("nav.nav").innerText();
  expect(menu).not.toContain("Usuarios y roles");
  await admin.goto("/usuarios");
  await admin.waitForURL(/sin-acceso/); // viendo como Ana no se administra nada
  // la base de datos rechaza escribir en este modo
  await admin.goto("/actividades/nuevo");
  await listo(admin, "Nuevo registro");
  await admin.getByRole("button", { name: "Salir de esta vista" }).click();
  await admin.waitForURL(/\/usuarios/);
  await listo(admin, "Usuarios y roles");
  await expect(admin.getByText(/Está viendo la aplicación como/)).toHaveCount(0);
});

test("el Super usuario cambia la clave de Ana: la clave temporal se ve una vez, su sesión se cierra, la anterior ya no entra y la temporal sí", async ({ browser }) => {
  await admin.goto("/usuarios?vista=personas");
  await listo(admin, "Personas con acceso");
  // en su propia fila no hay botón (su clave se cambia en «Mi cuenta»)
  await expect(admin.locator('section[aria-label="Personas con acceso"] tr', { hasText: "admin@prueba.co" }).getByRole("button", { name: "Cambiar clave" })).toHaveCount(0);
  const fila = admin.locator('section[aria-label="Personas con acceso"] tr', { hasText: "ana@prueba.co" });
  await fila.getByRole("button", { name: "Cambiar clave" }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.getByRole("button", { name: "Generar clave temporal" }).click();
  const temp = await dlg.getByLabel("Clave temporal").inputValue();
  expect(temp).toMatch(/^[A-HJ-NP-Za-km-z2-9]{14}$/);
  await expect(dlg.getByText("Se muestra una sola vez")).toBeVisible();
  await dlg.getByRole("button", { name: "Listo, ya la copié" }).click();
  // al reabrir, la clave ya no está: se muestra de nuevo el paso de confirmación y generaría OTRA
  await fila.getByRole("button", { name: "Cambiar clave" }).click();
  await expect(admin.getByRole("dialog").getByLabel("Clave temporal")).toHaveCount(0);
  await admin.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  // la sesión abierta de Ana se cerró
  await ana.goto("/cuenta");
  await ana.waitForURL(/\/(ingreso|login)/);
  // la clave anterior ya no entra y la temporal sí
  const otra = await abrir(browser);
  await otra.goto("/ingreso");
  await otra.fill("#u-email", "ana@prueba.co");
  await otra.fill("#u-pass", "Clave-nueva-de-Ana-9");
  await expect(otra.locator("#u-email")).toHaveValue("ana@prueba.co");
  await otra.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(otra.getByRole("alert")).toBeVisible();
  await otra.waitForLoadState("networkidle"); // tras el fallo la página termina de repintarse y vacía los campos: se escribe hasta que se asiente
  await otra.fill("#u-email", "ana@prueba.co");
  await otra.fill("#u-pass", temp);
  await expect(otra.locator("#u-email")).toHaveValue("ana@prueba.co");
  await otra.getByRole("button", { name: "Entrar", exact: true }).click();
  await otra.waitForURL((u) => u.pathname !== "/ingreso");
  // una persona sin permiso de administrar no llega a la pantalla
  await otra.goto("/usuarios");
  await otra.waitForURL(/sin-acceso/);
  await otra.context().close();
  anaClave = temp;
  ana = await abrir(browser); // la siguiente prueba vuelve a usar a Ana
  await ana.goto("/ingreso");
  await ana.fill("#u-email", "ana@prueba.co");
  await ana.fill("#u-pass", temp);
  await ana.getByRole("button", { name: "Entrar", exact: true }).click();
  await ana.waitForURL((u) => u.pathname !== "/ingreso");
});

test("rendimiento: una navegación valida la sesión una sola vez (más la del proxy) y entrega Server-Timing", async () => {
  for (const ruta of ["/cuenta", "/estudio", "/actividades"]) {
    const antes = await validaciones();
    const r = await ana.request.get(ruta); // una sola petición, sin JavaScript ni precargas del navegador
    expect(r.ok(), ruta).toBeTruthy();
    await r.text();
    const usadas = (await validaciones()) - antes;
    expect(usadas, `${ruta}: validaciones de sesión`).toBeLessThanOrEqual(2); // proxy + una compartida por el diseño y la página (antes eran 3 o 4)
    expect(r.headers()["server-timing"], ruta).toMatch(/auth;dur=[0-9]+, proxy;dur=[0-9]+/);
  }
});

test("Registro de cambios (Historia): lista lo hecho y quién lo hizo, filtra por tipo y palabra, se descarga a Excel y no lo ve quien no tiene Historia", async () => {
  const filas = 'section[aria-label="Registro de cambios"] tbody tr';
  await admin.goto("/historia?vista=cambios");
  await listo(admin, "Historia y desviaciones");
  await expect(admin.getByRole("tab", { name: "Registro de cambios" })).toBeVisible();
  await expect(admin.locator(filas).first()).toBeVisible();
  await expect(admin.getByText(/nadie puede modificar ni borrar este registro/)).toBeVisible();
  // lo de administración se aísla con el filtro de tipo
  await admin.goto("/historia?vista=cambios&tipo=admin");
  await listo(admin, "Historia y desviaciones");
  const secciones = await admin.locator(filas).locator("td:nth-child(3)").allInnerTexts();
  expect(secciones.length).toBeGreaterThan(0);
  expect([...new Set(secciones)]).toEqual(["Usuarios y roles"]);
  // la palabra clave encuentra el rol que se creó (sin distinguir mayúsculas) y una palabra inexistente no encuentra nada
  await admin.goto("/historia?vista=cambios&q=CAPTURISTA");
  await listo(admin, "Historia y desviaciones");
  await expect(admin.locator(filas).first()).toContainText("Capturista de actividades");
  await admin.goto("/historia?vista=cambios&q=zzzninguno");
  await listo(admin, "Historia y desviaciones");
  await expect(admin.getByText("Ningún cambio cumple los filtros.")).toBeVisible();
  // la descarga a Excel respeta los filtros
  const xlsx = await admin.request.get("/api/cambios/export?tipo=admin");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  expect((await xlsx.body()).length).toBeGreaterThan(1000);
  // quien no tiene Historia no ve la pestaña ni descarga
  await ana.goto("/historia?vista=cambios");
  await ana.waitForURL(/sin-acceso/);
  expect((await ana.request.get("/api/cambios/export")).status()).toBe(403);
});

test("Parámetros (D-103): el umbral de sobrecarga acepta más de 100 % (hasta 200 %), rechaza lo que pasa de ahí y Dotación requerida usa el valor", async () => {
  const guardar = () => admin.getByRole("button", { name: "Guardar parámetros" }).click();
  await admin.goto("/parametros");
  await listo(admin, "Parámetros");
  await expect(admin.getByText(/105 % acepta un poco de sobrecarga/)).toBeVisible(); // la ayuda del campo explica el uso
  await admin.fill("#p_overloadThreshold", "250");
  await guardar();
  await expect(admin.locator('.banner[role="alert"]')).toContainText("entre 0 y 200");
  await admin.fill("#p_overloadThreshold", "105");
  await guardar();
  await expect(admin.getByText(/Parámetros guardados/)).toBeVisible(); // esperar la confirmación: si se navega antes, el guardado se corta
  await admin.goto("/parametros");
  await listo(admin, "Parámetros");
  await expect(admin.locator("#p_overloadThreshold")).toHaveValue("105");
  await admin.goto("/resultados/dotacion");
  await listo(admin, "Dotación requerida");
  await expect(admin.getByText(/umbral de sobrecarga \(105 %\)/).first()).toBeVisible();
  // vuelve a 100 % para no afectar a las demás pruebas
  await admin.goto("/parametros");
  await listo(admin, "Parámetros");
  await admin.fill("#p_overloadThreshold", "100");
  await guardar();
  await expect(admin.getByText(/Parámetros guardados/)).toBeVisible(); // esperar la confirmación: si se navega antes, el guardado se corta
  await admin.goto("/parametros");
  await expect(admin.locator("#p_overloadThreshold")).toHaveValue("100");
});

test("cambiar de cuenta en el mismo navegador nunca muestra a la persona anterior", async ({ browser }) => {
  const nav = await abrir(browser);
  const entrar = async (correo: string, clave: string) => {
    await nav.goto("/ingreso");
    await nav.fill("#u-email", correo);
    await nav.fill("#u-pass", clave);
    await nav.getByRole("button", { name: "Entrar", exact: true }).click();
    await nav.waitForURL((u) => u.pathname !== "/ingreso");
  };
  await entrar("admin@prueba.co", "Clave-de-admin-1");
  await nav.goto("/cuenta");
  await listo(nav, "Mi cuenta");
  await expect(nav.locator(".topbar-user")).toContainText("admin@prueba.co");
  await nav.goto("/usuarios");
  await listo(nav, "Usuarios y roles");
  await nav.getByRole("button", { name: "Salir" }).click();
  await nav.waitForURL(/[/]ingreso/);
  await nav.goto("/cuenta"); // sin sesión no se ve nada
  await nav.waitForURL(/[/](ingreso|login)/);
  await entrar("ana@prueba.co", anaClave);
  await nav.goto("/cuenta");
  await listo(nav, "Mi cuenta");
  await expect(nav.locator(".topbar-user")).toContainText("ana@prueba.co");
  await expect(nav.locator(".topbar-user")).not.toContainText("admin@prueba.co");
  await nav.goto("/usuarios"); // y tiene los permisos de Ana, no los del Super usuario
  await nav.waitForURL(/sin-acceso/);
  await nav.context().close();
});

test("quitar el acceso es inmediato: la persona deja de entrar", async () => {
  await admin.goto("/usuarios?vista=personas");
  await listo(admin, "Personas con acceso");
  const fila = admin.locator('section[aria-label="Personas con acceso"] tr', { hasText: "ana@prueba.co" });
  await fila.getByRole("button", { name: "Quitar acceso" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Quitar acceso" }).click();
  await admin.waitForURL(/ok=/);
  await expect(admin.locator('section[aria-label="Personas con acceso"] tr', { hasText: "ana@prueba.co" })).toHaveCount(0);
  await ana.goto("/actividades");
  await expect(ana.getByText("E-1")).toHaveCount(0);
});

test("crear un estudio: aparece y queda activo de inmediato (la lista no queda con datos viejos)", async () => {
  await admin.goto("/estudio");
  await listo(admin, "Estudio");
  await admin.fill("#estudio-nombre", "Estudio nuevo de prueba");
  await admin.getByRole("button", { name: "Crear estudio" }).click();
  await expect(admin.getByText("Estudio creado con sus 14 áreas.")).toBeVisible();
  await expect(admin.locator("#estudio-id option:checked")).toContainText("Estudio nuevo de prueba");
  await expect(admin.locator(".sub").first()).toContainText("Estudio nuevo de prueba");
});
