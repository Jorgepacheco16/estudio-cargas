import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { addMembership, createTestUser, e2eEnabled, removeTestUser, signInCookies, type TestUser } from "./support/sesion";

/**
 * Recorrido completo CON SESIÓN contra la aplicación compilada y el Supabase de desarrollo: crear estudio → cargo → actividad → editar tiempo →
 * tablero → hoja 7 → exportar → foto → mediciones → desviaciones → salir. Usa un usuario temporal que se borra al terminar.
 * Se ejecuta con: E2E_SESSION=1 npx playwright test e2e/sesion.spec.ts --project=escritorio
 */
test.describe.configure({ mode: "serial" });
test.skip(!e2eEnabled, "Requiere E2E_SESSION=1 y las claves de desarrollo en .env.local (no corre en CI)");

let user: TestUser;
let viewer: TestUser | undefined;
let page: Page;
const sec = (name: string) => page.locator("section", { has: page.getByRole("heading", { name }) });
/** Los formularios usan acciones de servidor: solo funcionan cuando React ya hidrató la página, así que se espera a que cargue por completo. */
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(1000); };
const open = async (path: string) => { await page.goto(path); await settle(); };
const banner = (text: string | RegExp) => expect(page.locator(".banner").filter({ hasText: text })).toBeVisible();

test.beforeAll(async ({ browser, baseURL }) => {
  user = await createTestUser();
  const context = await browser.newContext({ baseURL, locale: "es-CO", timezoneId: "America/Bogota", acceptDownloads: true });
  await signInCookies(user, context, baseURL!);
  page = await context.newPage();
});
test.afterAll(async () => { await page?.context().close(); if (user) await removeTestUser(user); if (viewer) await removeTestUser(viewer); });

test("la sesión se reconoce y el estudio se crea con sus 14 áreas", async () => {
  await open("/estudio");
  await expect(page.getByRole("heading", { level: 1, name: "Estudio" })).toBeVisible();
  await expect(page.getByText(user.email).first()).toBeVisible();
  await page.getByLabel("Nuevo estudio").fill("Estudio E2E");
  await page.getByRole("button", { name: "Crear estudio" }).click();
  await banner("Estudio creado con sus 14 áreas");
  await open("/parametros");
  await expect(page.getByRole("heading", { name: "Áreas (14)" })).toBeVisible();
});

const BASE: Record<string, string> = { "2": "/cargos", "3": "/actividades", "7": "/diagnostico/riesgos" };
const nuevo = async (hoja: string) => { await open(`${BASE[hoja]}/nuevo`); };
const guardar = () => page.getByRole("button", { name: "Guardar", exact: true }).click();

test("se registra un cargo con su dotación desde la app (hoja 2) y la capacidad sale calculada, no editable", async () => {
  await nuevo("2");
  await page.locator("select[name=c_A]").selectOption("REAL");
  await page.locator("select[name=c_B]").selectOption({ label: "Cajas" });
  await page.locator("input[name=c_C]").fill("Sede E2E");
  await page.locator("input[name=c_E]").fill("Cajero E2E");
  await page.locator("input[name=c_F]").fill("2");
  await page.locator("input[name=c_K]").fill("42");
  await expect(page.getByRole("heading", { name: "Calculado por la hoja (no editable)" })).toBeVisible();
  await expect(page.locator("input[name=c_R], input[name=c_V]")).toHaveCount(0); // las columnas con fórmula no tienen campo
  await guardar();
  await banner("Registro creado");
  await expect(page.locator("tr", { hasText: "Cajero E2E" }).last()).toContainText("OK"); // la fila de la lista de registros (la última tabla de la sección)
});

test("se registra una actividad completa (hoja 3) y se calcula su carga; editar el tiempo la recalcula", async () => {
  await nuevo("3");
  await page.locator("select[name=c_A]").selectOption("REAL");
  await page.locator("input[name=c_B]").fill("E2E-1");
  await page.locator("select[name=c_D]").selectOption({ label: "Cajas" });
  await page.locator("input[name=c_E]").fill("Sede E2E");
  await page.locator("input[name=c_F]").fill("Cajero E2E");
  await page.locator("input[name=c_H]").fill("Arqueo de prueba");
  await page.locator("select[name=c_O]").selectOption({ label: "Por evento" });
  await page.locator("input[name=c_P]").fill("4");
  await page.locator("select[name=c_Q]").selectOption({ label: "Día" });
  await page.locator("select[name=c_R]").selectOption({ label: "Por colaborador" });
  await page.locator("input[name=c_T]").fill("5");
  await guardar();
  await banner("Registro creado");
  await open("/calculo?modo=real");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("4,00"); // 4/día × 6 días × 5 min ÷ 60 × 2 ocupantes
  await open("/actividades");
  await page.locator("tr", { hasText: "E2E-1" }).getByRole("link", { name: "Editar" }).click(); await settle();
  await page.locator("input[name=c_T]").fill("10");
  await guardar();
  await banner("Registro actualizado");
  await open("/calculo?modo=real");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("8,00");
});

test("una actividad con código repetido se rechaza con un mensaje claro", async () => {
  await nuevo("3");
  await page.locator("input[name=c_B]").fill("E2E-1");
  await page.locator("select[name=c_D]").selectOption({ label: "Cajas" });
  await page.locator("input[name=c_E]").fill("Sede E2E");
  await page.locator("input[name=c_F]").fill("Cajero E2E");
  await page.locator("input[name=c_H]").fill("Repetida");
  await guardar();
  await banner("Ya existe un registro con esa clave");
});

test("409 por versión desactualizada: dos pestañas editan la misma actividad y la segunda recibe el conflicto sin pisar a la primera", async () => {
  const other = await page.context().newPage();
  try {
    await open("/actividades");
    await page.locator("tr", { hasText: "E2E-1" }).getByRole("link", { name: "Editar" }).click(); await settle();
    await page.waitForURL(/\/actividades\/[0-9a-f-]{36}$/); await settle();
    const url = page.url();                  // esta pestaña queda con la versión vista
    await other.goto(url); await other.waitForLoadState("networkidle"); await other.waitForTimeout(1000);
    await expect(other.locator("input[name=c_T]"), `la segunda pestaña (${other.url()}) muestra: ${(await other.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300)}`).toBeVisible({ timeout: 15000 });
    await other.locator("input[name=c_T]").fill("11");  // distinto del valor guardado (10) para que haya un cambio real y suba la versión
    await other.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(other.locator(".banner").filter({ hasText: "Registro actualizado" })).toBeVisible();   // la otra pestaña guarda primero: sube la versión
    await page.locator("input[name=c_T]").fill("77");
    await guardar();
    await banner("Conflicto (409)");
    await page.goto(url); await settle();
    await expect(page.locator("input[name=c_T]")).toHaveValue("11"); // el 77 no se guardó
  } finally { await other.close(); }
});

test("un usuario de solo lectura (viewer) ve los datos pero no puede modificar nada", async ({ browser, baseURL }) => {
  viewer = await createTestUser();
  await addMembership(user, viewer, "viewer");
  const ctx = await browser.newContext({ baseURL, locale: "es-CO", timezoneId: "America/Bogota" });
  try {
    await signInCookies(viewer, ctx, baseURL!);
    const p = await ctx.newPage();
    for (const [ruta, boton] of [["/cargos/nuevo", "Guardar"], ["/diagnostico/riesgos/nuevo", "Guardar"]] as const) {
      await p.goto(ruta); await p.waitForLoadState("networkidle");
      await expect(p.getByText("Su rol es de solo lectura")).toBeVisible();
      await expect(p.getByRole("button", { name: boton }).first()).toBeDisabled();
    }
    await p.goto("/?modo=real"); await p.waitForLoadState("networkidle");
    await expect(p.getByLabel("Indicadores").locator(".card", { hasText: "Actividades registradas" }).locator(".kpi")).toHaveText("1"); // sí puede leer
    await p.goto("/integraciones"); await p.waitForLoadState("networkidle");
    await expect(p.getByRole("button", { name: "Conectar" })).toBeDisabled();
    await p.goto("/historia?vista=productividad"); await p.waitForLoadState("networkidle");
    await expect(p.getByRole("button", { name: "Guardar medición" })).toBeDisabled();
  } finally { await ctx.close(); }
});

test("el tablero en modo REAL refleja la actividad registrada", async () => {
  await open("/?modo=real");
  const kpi = (label: string) => page.getByLabel("Indicadores").locator(".card", { hasText: label }).locator(".kpi");
  await expect(kpi("Actividades registradas")).toHaveText("1");
  await expect(kpi("Horas/semana inventariadas")).toHaveText("8,8"); // 4/día × 6 días × 11 min ÷ 60 × 2 ocupantes
  await expect(kpi("Capacidad disponible")).toHaveText("75,6");
  await expect(page.getByLabel("Carga por cargo", { exact: true })).toContainText("Cajero E2E");
});

test("hoja 7: se captura el riesgo desde la app y se muestra la criticidad calculada con las reglas del Excel (no editable)", async () => {
  await nuevo("7");
  await page.locator("select[name=c_B]").selectOption("E2E-1");
  await page.locator("input[name=c_K]").fill("5");
  await page.locator("input[name=c_M]").fill("3");
  await page.locator("input[name=c_Q]").fill("1");
  await guardar();
  await banner("Registro creado");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Crítica");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Requiere respaldo prioritario");
});

test("un valor inválido al editar un registro se rechaza (escala 1 a 5) y el dato no cambia", async () => {
  await open("/diagnostico/riesgos");
  await page.locator("tr", { hasText: "E2E-1" }).getByRole("link", { name: "Editar" }).click();
  await settle();
  await page.locator("input[name=c_K]").fill("9");
  await guardar();
  await banner(/Impacto legal.*fuera de la escala 1–5/);
  await open("/diagnostico/riesgos");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Crítica"); // el registro anterior sigue igual
});
test("la exportación a Excel con sesión trae los datos del estudio", async () => {
  await open("/cargos?modo=real");
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar Excel" }).click()]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile((await d.path())!);
  const cells: string[] = []; wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "string") cells.push(c.value); })));
  expect(cells).toContain("Cajero E2E");
});

test("el respaldo completo en Excel se descarga y trae los datos del estudio", async () => {
  await open("/estudio");
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar respaldo completo (Excel)" }).click()]);
  expect(d.suggestedFilename()).toMatch(/^respaldo-estudio_.*\.xlsx$/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile((await d.path())!);
  expect(wb.getWorksheet("Actividades")!.rowCount).toBeGreaterThanOrEqual(2);
  expect(wb.getWorksheet("Léame")).toBeTruthy();
});

test("historia: foto, mediciones con índice de productividad y detección de desviaciones", async () => {
  test.setTimeout(240_000); // muchos pasos contra un Supabase remoto
  await open("/historia?vista=linea");
  await page.locator("input[name=label]").fill("Foto E2E");
  await page.getByRole("button", { name: "Tomar foto ahora" }).click();
  await banner("Foto del tablero guardada");
  await expect(page.getByRole("heading", { name: /Fotos del tablero \(1\)/ })).toBeVisible();

  await open("/historia?vista=productividad");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Sin mediciones");
  for (let i = 0; i < 3; i++) {
    const f = page.locator("form", { has: page.locator("input[name=personHours]") });
    await f.locator("select[name=activityId]").selectOption({ label: "E2E-1" });
    await f.locator("input[name=observedAt]").fill("2026-10-20");
    await f.locator("input[name=unitsProcessed]").fill("10");
    await f.locator("input[name=personHours]").fill("1");
    await f.getByRole("button", { name: "Guardar medición" }).click();
    await banner("Medición guardada");
  }
  await expect(page.locator("tr", { hasText: "E2E-1" }).first()).toContainText("1,83"); // real 10/h ÷ estándar 5,45/h (11 min por ejecución)

  await open("/historia?vista=desviaciones");
  await page.getByRole("button", { name: "Detectar desviaciones ahora" }).click();
  await banner("Detección terminada: 1 nueva");
  const row = page.locator("tr", { hasText: "R1" });
  await expect(row).toContainText("el tiempo medido difiere");
  await row.getByRole("button", { name: "Reconocer" }).click();
  await expect(page.locator("tr", { hasText: "R1" }).locator(".pill")).toHaveText("Reconocida");
  await page.getByRole("button", { name: "Detectar desviaciones ahora" }).click();
  await banner("0 nueva(s)"); // no duplica una desviación ya reconocida
});

test("integraciones y agente cargan para el propietario", async () => {
  await open("/integraciones");
  await expect(page.getByRole("heading", { name: "Conectar una hoja" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar" })).toBeEnabled();
  await open("/agente");
  await expect(page.getByRole("heading", { name: "Ejecutar análisis" })).toBeVisible();
});

test("cerrar sesión devuelve al ingreso y protege las páginas de captura", async () => {
  await open("/");
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.getByRole("link", { name: "Ingresar" })).toBeVisible();
  await open("/estudio");
  await expect(page).toHaveURL(/\/login/);
});
