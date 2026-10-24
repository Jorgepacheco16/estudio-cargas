import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Recorrido público (sin sesión): tablero DEMO, navegación, rutas protegidas, descargas, cabeceras, móvil, tema oscuro y accesibilidad. */

test("el tablero muestra los 12 indicadores y las secciones A a F con datos DEMO", async ({ page }) => {
  await page.goto("/?modo=demo");
  await expect(page.getByRole("heading", { level: 1, name: "Tablero ejecutivo" })).toBeVisible();
  await expect(page.getByLabel("Indicadores").locator(".card")).toHaveCount(12);
  for (const h of ["A. Carga laboral por área", "C. Las 10 actividades que más horas consumen", "D. Cobertura y calidad de la información", "E. Oportunidades de mejora y plan de acción", "F. Conclusiones preliminares"]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(page.getByText(/demostración|DEMO/i).first()).toBeVisible();
  await expect(page.getByAltText("Megatiendas")).toBeVisible();
});

test("el selector de modo cambia entre DEMO, REAL y TODOS sin errores", async ({ page }) => {
  await page.goto("/");
  for (const modo of ["real", "all", "demo"]) {
    await page.locator("select[name=modo]").selectOption(modo);
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL(new RegExp(`modo=${modo}`));
    await expect(page.getByRole("heading", { level: 1, name: "Tablero ejecutivo" })).toBeVisible();
  }
});

test("toda la navegación principal responde y las páginas de captura piden iniciar sesión", async ({ page }) => {
  await page.goto("/");
  const links = await page.getByRole("navigation", { name: "Principal" }).getByRole("link").evaluateAll((a) => a.map((x) => ({ href: (x as HTMLAnchorElement).getAttribute("href")!, text: x.textContent!.trim() })));
  expect(links.length).toBeGreaterThanOrEqual(8);
  for (const l of links) {
    const r = await page.goto(l.href);
    expect(r?.status(), `${l.text} (${l.href})`).toBeLessThan(400);
    if (["/estudio", "/captura", "/integraciones", "/historia"].includes(l.href)) await expect(page, `${l.href} debe pedir sesión`).toHaveURL(/\/login/);
  }
});

test("la página de ingreso ofrece Google y no filtra detalles", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Ingresar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar con Google" })).toBeEnabled();
  expect(await page.content()).not.toMatch(/service_role|sb_secret|postgres:\/\//i);
});

test("las vistas descargan Excel, CSV y PDF válidos", async ({ page }) => {
  await page.goto("/cargos?modo=demo");
  const sig = async (name: string) => {
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name }).click()]);
    const path = await d.path();
    const { readFileSync } = await import("node:fs");
    return { file: d.suggestedFilename(), bytes: readFileSync(path!) };
  };
  const x = await sig("Exportar Excel"); expect(x.file).toMatch(/\.xlsx$/); expect(x.bytes.subarray(0, 2).toString()).toBe("PK");
  const c = await sig("Exportar CSV"); expect(c.file).toMatch(/\.csv$/); expect(c.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true); expect(c.bytes.toString("utf8")).toContain(";");
  const p = await sig("Exportar PDF"); expect(p.file).toMatch(/\.pdf$/); expect(p.bytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("cabeceras de seguridad y rutas internas sin firma", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["strict-transport-security"]).toContain("max-age");
  expect(h["x-powered-by"]).toBeUndefined();
  expect((await request.post("/api/sheets/webhook", { data: "{}" })).status()).toBeGreaterThanOrEqual(401);
  expect((await request.get("/api/sheets/reconcile")).status()).toBe(401);
  expect((await request.get("/api/history/snapshot")).status()).toBe(401);
  expect((await request.get("/api/export/vista-inexistente")).status()).toBe(404);
});

test("sin desbordamiento horizontal y con tema oscuro legible", async ({ page }) => {
  await page.goto("/?modo=demo");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "la página no debe tener scroll horizontal").toBeLessThanOrEqual(1);
  await page.emulateMedia({ colorScheme: "dark" });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(244, 246, 251)");
});

for (const ruta of ["/?modo=demo", "/login", "/cargos?modo=demo", "/actividades?modo=demo", "/sedes?modo=demo", "/drill?modo=demo&level=area&area=Cajas"]) {
  test(`accesibilidad (axe, sin fallas serias ni críticas): ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(graves.map((v) => `${v.id}: ${v.nodes.length} elemento(s) · ${v.help}`)).toEqual([]);
  });
}

test("el drill-down baja de nivel con un clic y el comparador de sedes se exporta", async ({ page }) => {
  await page.goto("/drill?modo=demo");
  await expect(page.getByRole("heading", { name: /Drill-down/ })).toBeVisible();
  await page.getByRole("table").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/level=area/);
  await expect(page.getByRole("navigation", { name: "Ruta del drill-down" })).toContainText("Estudio");
  await page.goto("/sedes?modo=demo");
  await expect(page.getByRole("heading", { name: "Comparador de sedes" })).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(d.suggestedFilename()).toMatch(/sedes.*\.xlsx$/);
});