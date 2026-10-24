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
  await expect(sec("Cargo y dotación").locator("select[name=area] option")).toHaveCount(14);
});

test("se registra un cargo con su dotación", async () => {
  const s = sec("Cargo y dotación");
  await s.locator("select[name=area]").selectOption({ label: "Cajas" });
  await s.locator("input[name=site]").fill("Sede E2E");
  await s.locator("input[name=position]").fill("Cajero E2E");
  await s.locator("input[name=headcount]").fill("2");
  await s.locator("input[name=weeklyHours]").fill("42");
  await s.getByRole("button", { name: "Guardar cargo" }).click();
  await banner("Cargo y dotación guardados");
});

test("se registra una actividad completa y se calcula su carga; editar el tiempo la recalcula", async () => {
  const s = sec("Nueva actividad");
  await s.locator("input[name=code]").fill("E2E-1");
  await s.locator("input[name=name]").fill("Arqueo de prueba");
  await s.locator("select[name=positionId]").selectOption({ label: "Cajero E2E · Sede E2E (Cajas)" });
  await s.locator("select[name=calcMode]").selectOption("per_event");
  await s.locator("select[name=scope]").selectOption("per_employee");
  await s.locator("input[name=executions]").fill("4");
  await s.locator("select[name=period]").selectOption("day");
  await s.locator("input[name=timeAvgMin]").fill("5");
  await s.getByRole("button", { name: "Guardar actividad" }).click();
  await banner("Actividad guardada");
  const row = page.locator("tr", { hasText: "E2E-1" });
  await expect(row).toContainText("OK");
  await expect(row).toContainText("4,00"); // 4/día × 6 días × 5 min ÷ 60 × 2 ocupantes
  await row.getByLabel("Tiempo promedio de E2E-1").fill("10");
  await row.getByRole("button", { name: "Guardar" }).click();
  await banner("Tiempo actualizado");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("8,00");
});

test("una actividad con código repetido se rechaza con un mensaje claro", async () => {
  const s = sec("Nueva actividad");
  await s.locator("input[name=code]").fill("E2E-1");
  await s.locator("input[name=name]").fill("Repetida");
  await s.locator("select[name=positionId]").selectOption({ label: "Cajero E2E · Sede E2E (Cajas)" });
  await s.getByRole("button", { name: "Guardar actividad" }).click();
  await banner("Ya existe un registro con ese código");
});

test("409 por versión desactualizada: dos pestañas editan la misma actividad y la segunda recibe el conflicto sin pisar a la primera", async () => {
  const other = await page.context().newPage();
  try {
    await open("/estudio");                 // esta pestaña queda con la versión vista
    await other.goto("/estudio"); await other.waitForLoadState("networkidle"); await other.waitForTimeout(1000);
    const row2 = other.locator("tr", { hasText: "E2E-1" });
    await row2.getByLabel("Tiempo promedio de E2E-1").fill("10");
    await row2.getByRole("button", { name: "Guardar" }).click();
    await expect(other.locator(".banner").filter({ hasText: "Tiempo actualizado" })).toBeVisible();   // la otra pestaña guarda primero: sube la versión
    const row = page.locator("tr", { hasText: "E2E-1" });
    await row.getByLabel("Tiempo promedio de E2E-1").fill("77");
    await row.getByRole("button", { name: "Guardar" }).click();
    await banner("Conflicto (409)");
    await open("/estudio");
    await expect(page.locator("tr", { hasText: "E2E-1" }).getByLabel("Tiempo promedio de E2E-1")).toHaveValue("10"); // el 77 no se guardó
  } finally { await other.close(); }
});

test("un usuario de solo lectura (viewer) ve los datos pero no puede modificar nada", async ({ browser, baseURL }) => {
  viewer = await createTestUser();
  await addMembership(user, viewer, "viewer");
  const ctx = await browser.newContext({ baseURL, locale: "es-CO", timezoneId: "America/Bogota" });
  try {
    await signInCookies(viewer, ctx, baseURL!);
    const p = await ctx.newPage();
    for (const [ruta, boton] of [["/estudio", "Guardar cargo"], ["/captura?hoja=7", "Guardar"]] as const) {
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
  await expect(kpi("Horas/semana inventariadas")).toHaveText("8,0");
  await expect(kpi("Capacidad disponible")).toHaveText("75,6");
  await expect(page.getByLabel("Carga por cargo", { exact: true })).toContainText("Cajero E2E");
});

test("hoja 7: se captura el riesgo y se muestra la criticidad calculada con las reglas del Excel", async () => {
  await open("/captura?hoja=7");
  const form = page.locator("form", { has: page.locator("input[name=hoja][value='7']") });
  await form.locator("select[name=activityId]").selectOption({ label: "E2E-1" });
  await form.locator("input[name=impactLegal]").fill("5");
  await form.locator("input[name=probability]").fill("3");
  await form.locator("input[name=peopleWhoCanExecute]").fill("1");
  await form.getByRole("button", { name: "Guardar" }).click();
  await banner("Registro creado");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Criticidad Crítica");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Requiere respaldo prioritario");
});

test("un valor inválido al editar un registro se rechaza (escala 1 a 5) y el dato no cambia", async () => {
  await open("/captura?hoja=7");
  await page.locator("tr", { hasText: "E2E-1" }).getByRole("link", { name: "Editar" }).click();
  await settle();
  const form = page.locator("form", { has: page.locator("input[name=hoja][value='7']") });
  await form.locator("input[name=impactLegal]").fill("9");
  await form.getByRole("button", { name: "Guardar" }).click();
  await banner("Impacto legal: escriba un entero entre 1 y 5");
  await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Criticidad Crítica"); // el registro anterior sigue igual
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
  await expect(page.locator("tr", { hasText: "E2E-1" }).first()).toContainText("1,67"); // real 10/h ÷ estándar 6/h

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
