# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sesion.spec.ts >> un valor inválido al editar un registro se rechaza (escala 1 a 5) y el dato no cambia
- Location: e2e\sesion.spec.ts:101:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.banner').filter({ hasText: 'Impacto legal: escriba un entero entre 1 y 5' })
Expected: visible
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.banner').filter({ hasText: 'Impacto legal: escriba un entero entre 1 y 5' }) with timeout 30000ms
  - waiting for locator('.banner').filter({ hasText: 'Impacto legal: escriba un entero entre 1 y 5' })

```

```yaml
- banner:
  - img "Megatiendas"
  - text: Estudio de Actividades y Cargas Laborales e2e-6febf8e3@example.com
  - button "Salir"
- navigation "Principal":
  - link "Tablero":
    - /url: /
  - link "Cargos y dotación":
    - /url: /cargos
  - link "Actividades":
    - /url: /actividades
  - link "Estudio (captura)":
    - /url: /estudio
  - link "Hojas 5–10 y parámetros":
    - /url: /captura
  - link "Historia y desviaciones":
    - /url: /historia
  - link "Integraciones":
    - /url: /integraciones
  - link "Agente de IA":
    - /url: /agente
- main:
  - heading "Captura de hojas 5 a 10" [level=1]
  - text: Estudio E2E · los resultados se calculan con las mismas reglas del Excel
  - tablist "Hojas de captura":
    - tab "5 · Medibilidad"
    - tab "6 · Pertinencia"
    - tab "7 · Riesgos" [selected]
    - tab "8 · Oportunidades"
    - tab "9 · Rediseño"
    - tab "10 · Plan de acción"
    - tab "Parámetros"
  - heading "Editar · E2E-1" [level=2]
  - text: Actividad *
  - combobox "Actividad *" [disabled]:
    - option "E2E-1" [selected]
  - text: Riesgo
  - textbox "Riesgo"
  - text: Consecuencias
  - textbox "Consecuencias"
  - text: Impacto operativo
  - textbox "Impacto operativo":
    - /placeholder: 1 a 5
  - text: Impacto económico
  - textbox "Impacto económico":
    - /placeholder: 1 a 5
  - text: Impacto laboral
  - textbox "Impacto laboral":
    - /placeholder: 1 a 5
  - text: Impacto legal
  - textbox "Impacto legal":
    - /placeholder: 1 a 5
    - text: "9"
  - text: Impacto en servicio
  - textbox "Impacto en servicio":
    - /placeholder: 1 a 5
  - text: Probabilidad
  - textbox "Probabilidad":
    - /placeholder: 1 a 5
    - text: "3"
  - text: Controles
  - textbox "Controles"
  - text: Evidencia
  - textbox "Evidencia"
  - text: Dependencias
  - textbox "Dependencias"
  - text: Personas que la saben ejecutar
  - textbox "Personas que la saben ejecutar": "1"
  - text: Duplicidades
  - textbox "Duplicidades"
  - text: ¿Incompatibilidad de funciones?
  - combobox "¿Incompatibilidad de funciones?":
    - option "(sin definir)" [selected]
    - option "Sí"
    - option "No"
  - button "Guardar"
  - link "Cancelar":
    - /url: /captura?hoja=7
  - paragraph: "Los campos vacíos se guardan vacíos: la aplicación no inventa valores. Un resultado «incompleto» indica qué falta capturar."
  - heading "Registros (1)" [level=2]
  - region "Tabla desplazable":
    - table:
      - rowgroup:
        - row "Actividad Resultado calculado Acciones":
          - columnheader "Actividad"
          - columnheader "Resultado calculado"
          - columnheader "Acciones"
      - rowgroup:
        - row "E2E-1 Criticidad Crítica · Alta concentración · Requiere respaldo prioritario Editar Eliminar":
          - cell "E2E-1"
          - cell "Criticidad Crítica · Alta concentración · Requiere respaldo prioritario"
          - cell "Editar Eliminar":
            - link "Editar":
              - /url: /captura?hoja=7&id=db3b9307-cee0-4f0f-bc88-25964e4cbd78
            - button "Eliminar"
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | import ExcelJS from "exceljs";
  3   | import { createTestUser, e2eEnabled, removeTestUser, signInCookies, type TestUser } from "./support/sesion";
  4   | 
  5   | /**
  6   |  * Recorrido completo CON SESIÓN contra la aplicación compilada y el Supabase de desarrollo: crear estudio → cargo → actividad → editar tiempo →
  7   |  * tablero → hoja 7 → exportar → foto → mediciones → desviaciones → salir. Usa un usuario temporal que se borra al terminar.
  8   |  * Se ejecuta con: E2E_SESSION=1 npx playwright test e2e/sesion.spec.ts --project=escritorio
  9   |  */
  10  | test.describe.configure({ mode: "serial" });
  11  | test.skip(!e2eEnabled, "Requiere E2E_SESSION=1 y las claves de desarrollo en .env.local (no corre en CI)");
  12  | 
  13  | let user: TestUser;
  14  | let page: Page;
  15  | const sec = (name: string) => page.locator("section", { has: page.getByRole("heading", { name }) });
  16  | /** Los formularios usan acciones de servidor: solo funcionan cuando React ya hidrató la página, así que se espera a que cargue por completo. */
  17  | const open = async (path: string) => { await page.goto(path); await page.waitForLoadState("networkidle"); };
> 18  | const banner = (text: string | RegExp) => expect(page.locator(".banner").filter({ hasText: text })).toBeVisible();
      |                                                                                                     ^ Error: expect(locator).toBeVisible() failed
  19  | 
  20  | test.beforeAll(async ({ browser, baseURL }) => {
  21  |   user = await createTestUser();
  22  |   const context = await browser.newContext({ baseURL, locale: "es-CO", timezoneId: "America/Bogota", acceptDownloads: true });
  23  |   await signInCookies(user, context, baseURL!);
  24  |   page = await context.newPage();
  25  | });
  26  | test.afterAll(async () => { await page?.context().close(); if (user) await removeTestUser(user); });
  27  | 
  28  | test("la sesión se reconoce y el estudio se crea con sus 14 áreas", async () => {
  29  |   await open("/estudio");
  30  |   await expect(page.getByRole("heading", { level: 1, name: "Estudio" })).toBeVisible();
  31  |   await expect(page.getByText(user.email).first()).toBeVisible();
  32  |   await page.getByLabel("Nuevo estudio").fill("Estudio E2E");
  33  |   await page.getByRole("button", { name: "Crear estudio" }).click();
  34  |   await banner("Estudio creado con sus 14 áreas");
  35  |   await expect(sec("Cargo y dotación").locator("select[name=area] option")).toHaveCount(14);
  36  | });
  37  | 
  38  | test("se registra un cargo con su dotación", async () => {
  39  |   const s = sec("Cargo y dotación");
  40  |   await s.locator("select[name=area]").selectOption({ label: "Cajas" });
  41  |   await s.locator("input[name=site]").fill("Sede E2E");
  42  |   await s.locator("input[name=position]").fill("Cajero E2E");
  43  |   await s.locator("input[name=headcount]").fill("2");
  44  |   await s.locator("input[name=weeklyHours]").fill("42");
  45  |   await s.getByRole("button", { name: "Guardar cargo" }).click();
  46  |   await banner("Cargo y dotación guardados");
  47  | });
  48  | 
  49  | test("se registra una actividad completa y se calcula su carga; editar el tiempo la recalcula", async () => {
  50  |   const s = sec("Nueva actividad");
  51  |   await s.locator("input[name=code]").fill("E2E-1");
  52  |   await s.locator("input[name=name]").fill("Arqueo de prueba");
  53  |   await s.locator("select[name=positionId]").selectOption({ label: "Cajero E2E · Sede E2E (Cajas)" });
  54  |   await s.locator("select[name=calcMode]").selectOption("per_event");
  55  |   await s.locator("select[name=scope]").selectOption("per_employee");
  56  |   await s.locator("input[name=executions]").fill("4");
  57  |   await s.locator("select[name=period]").selectOption("day");
  58  |   await s.locator("input[name=timeAvgMin]").fill("5");
  59  |   await s.getByRole("button", { name: "Guardar actividad" }).click();
  60  |   await banner("Actividad guardada");
  61  |   const row = page.locator("tr", { hasText: "E2E-1" });
  62  |   await expect(row).toContainText("OK");
  63  |   await expect(row).toContainText("4,00"); // 4/día × 6 días × 5 min ÷ 60 × 2 ocupantes
  64  |   await row.getByLabel("Tiempo promedio de E2E-1").fill("10");
  65  |   await row.getByRole("button", { name: "Guardar" }).click();
  66  |   await banner("Tiempo actualizado");
  67  |   await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("8,00");
  68  | });
  69  | 
  70  | test("una actividad con código repetido se rechaza con un mensaje claro", async () => {
  71  |   const s = sec("Nueva actividad");
  72  |   await s.locator("input[name=code]").fill("E2E-1");
  73  |   await s.locator("input[name=name]").fill("Repetida");
  74  |   await s.locator("select[name=positionId]").selectOption({ label: "Cajero E2E · Sede E2E (Cajas)" });
  75  |   await s.getByRole("button", { name: "Guardar actividad" }).click();
  76  |   await banner("Ya existe un registro con ese código");
  77  | });
  78  | 
  79  | test("el tablero en modo REAL refleja la actividad registrada", async () => {
  80  |   await open("/?modo=real");
  81  |   const kpi = (label: string) => page.getByLabel("Indicadores").locator(".card", { hasText: label }).locator(".kpi");
  82  |   await expect(kpi("Actividades registradas")).toHaveText("1");
  83  |   await expect(kpi("Horas/semana inventariadas")).toHaveText("8,0");
  84  |   await expect(kpi("Capacidad disponible")).toHaveText("75,6");
  85  |   await expect(page.getByLabel("Carga por cargo", { exact: true })).toContainText("Cajero E2E");
  86  | });
  87  | 
  88  | test("hoja 7: se captura el riesgo y se muestra la criticidad calculada con las reglas del Excel", async () => {
  89  |   await open("/captura?hoja=7");
  90  |   const form = page.locator("form", { has: page.locator("input[name=hoja][value='7']") });
  91  |   await form.locator("select[name=activityId]").selectOption({ label: "E2E-1" });
  92  |   await form.locator("input[name=impactLegal]").fill("5");
  93  |   await form.locator("input[name=probability]").fill("3");
  94  |   await form.locator("input[name=peopleWhoCanExecute]").fill("1");
  95  |   await form.getByRole("button", { name: "Guardar" }).click();
  96  |   await banner("Registro creado");
  97  |   await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Criticidad Crítica");
  98  |   await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Requiere respaldo prioritario");
  99  | });
  100 | 
  101 | test("un valor inválido al editar un registro se rechaza (escala 1 a 5) y el dato no cambia", async () => {
  102 |   await open("/captura?hoja=7");
  103 |   await page.locator("tr", { hasText: "E2E-1" }).getByRole("link", { name: "Editar" }).click();
  104 |   await page.waitForLoadState("networkidle");
  105 |   const form = page.locator("form", { has: page.locator("input[name=hoja][value='7']") });
  106 |   await form.locator("input[name=impactLegal]").fill("9");
  107 |   await form.getByRole("button", { name: "Guardar" }).click();
  108 |   await banner("Impacto legal: escriba un entero entre 1 y 5");
  109 |   await expect(page.locator("tr", { hasText: "E2E-1" })).toContainText("Criticidad Crítica"); // el registro anterior sigue igual
  110 | });
  111 | test("la exportación a Excel con sesión trae los datos del estudio", async () => {
  112 |   await open("/cargos?modo=real");
  113 |   const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar Excel" }).click()]);
  114 |   const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile((await d.path())!);
  115 |   const cells: string[] = []; wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "string") cells.push(c.value); })));
  116 |   expect(cells).toContain("Cajero E2E");
  117 | });
  118 | 
```