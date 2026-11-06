import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Recorrido sin cuenta (D-76): la página de ingreso y la puerta de entrada (sin ingresar no se ve ninguna pantalla interna) y, entrando como INVITADO con
 * el usuario y la clave de la demostración, el tablero DEMO, la navegación, las descargas, las cabeceras, el móvil, el tema oscuro y la accesibilidad.
 * Las pruebas cuyo título empieza con «[anónimo]» corren sin ingresar; las demás entran como invitado antes de empezar.
 * El usuario y la clave de la demostración vienen de E2E_DEMO_USER y E2E_DEMO_PASSWORD (el servidor local los recibe como DEMO_USER y DEMO_PASSWORD_HASH).
 */
const DEMO_USER = process.env.E2E_DEMO_USER ?? process.env.DEMO_USER ?? "";
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "";

async function entrarComoInvitado(page: Page) {
  if (!DEMO_USER || !DEMO_PASSWORD) throw new Error("Faltan E2E_DEMO_USER y E2E_DEMO_PASSWORD (usuario y clave de la demostración) para entrar como invitado.");
  await page.goto("/ingreso?modo=invitado");
  await page.fill("#g-user", DEMO_USER);
  await page.fill("#g-pass", DEMO_PASSWORD);
  await page.getByRole("button", { name: "Entrar a la demostración" }).click();
  await page.waitForURL((u) => u.pathname === "/");
}
test.beforeEach(async ({ page }, info) => { if (!info.title.startsWith("[anónimo]")) await entrarComoInvitado(page); });

test("[anónimo] la página de ingreso muestra la marca, el ingreso con usuario y clave, Google y el acceso de invitado, y no filtra detalles", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/ingreso/); // quien abre el enlace ve primero el ingreso
  await expect(page.getByRole("heading", { name: "Ingresar" })).toBeVisible();
  await expect(page.getByRole("img", { name: "BalanceAPP" }).first()).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Clave")).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Entrar con Google" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Ingresar como invitado" })).toBeVisible();
  const img = page.locator(".auth-art-figure img");
  if ((page.viewportSize()?.width ?? 0) > 900) {
    // En pantallas anchas se ve la imagen con su frase; en el teléfono el ingreso muestra solo el formulario.
    await expect(page.getByText("Equilibre la carga de trabajo con la capacidad de su equipo.")).toBeVisible();
    await expect(img).toBeVisible();
    expect(await img.evaluate((e) => (e as HTMLImageElement).naturalWidth), "la imagen del ingreso debe cargar (no la bloquea la puerta de entrada)").toBeGreaterThan(300);
    // La imagen debe cubrir TODO el panel (si no, se vería el fondo de reserva). Con el tamaño de pantalla de la prueba (1280×720) falló una vez por una altura automática del panel.
    const cubre = await page.evaluate(`(() => { const a = document.querySelector(".auth-art").getBoundingClientRect(), f = document.querySelector(".auth-art-figure").getBoundingClientRect(); return f.width >= a.width - 1 && f.height >= a.height - 1; })()`);
    expect(cubre, "la imagen debe cubrir todo el panel").toBe(true);
  } else {
    await expect(img).toBeHidden();
  }
  await expect(page.getByRole("navigation", { name: "Principal" })).toHaveCount(0); // sin menú: solo el ingreso
  expect(await page.content()).not.toMatch(/service_role|sb_secret|postgres:\/\/|DEMO_PASSWORD|GUEST_SESSION_SECRET/i);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/ingreso/); // la ruta anterior lleva a la misma página
});

test("[anónimo] sin ingresar no se ve ninguna pantalla interna ni se descarga nada; las tareas programadas y el webhook siguen respondiendo por su propia firma", async ({ request }) => {
  for (const ruta of ["/", "/cargos", "/actividades?modo=demo", "/calculo", "/resultados/dotacion", "/resultados/reparto", "/resultados/agente", "/drill", "/diagnostico/riesgos", "/sedes"]) {
    const r = await request.get(ruta, { maxRedirects: 0 });
    expect(r.status(), ruta).toBe(307);
    expect(r.headers()["location"], ruta).toContain("/ingreso");
  }
  expect((await request.get("/api/export/cargos?format=csv", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.get("/api/plantilla/2", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.get("/api/sheets/reconcile", { maxRedirects: 0 })).status()).toBe(401); // lo rechaza su propia clave, no la puerta
  expect((await request.get("/api/history/snapshot", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.post("/api/sheets/webhook", { data: "{}" })).status()).toBeGreaterThanOrEqual(401);
});

test("[anónimo] el invitado con una clave incorrecta no entra; con la correcta ve la demostración y puede salir", async ({ page }) => {
  await page.goto("/ingreso?modo=invitado");
  await expect(page.getByRole("heading", { name: "Acceso de invitado" })).toBeVisible();
  await page.fill("#g-user", DEMO_USER); await page.fill("#g-pass", "clave-incorrecta");
  await page.getByRole("button", { name: "Entrar a la demostración" }).click();
  await expect(page.locator(".auth-error")).toContainText("no son correctos");
  await expect(page).toHaveURL(/\/ingreso/);
  await entrarComoInvitado(page);
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  await expect(page.getByText("Invitado", { exact: true })).toBeVisible();
  await page.goto("/estudio"); // requiere una cuenta de usuario
  await expect(page).toHaveURL(/\/ingreso\?requiere=1/);
  await page.goto("/");
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/ingreso/);
  await page.goto("/cargos");
  await expect(page).toHaveURL(/\/ingreso/); // al salir, la puerta vuelve a cerrarse
});

test("el encabezado lleva la marca BalanceAPP a la izquierda y el cliente en tamaño reducido a la derecha", async ({ page }) => {
  await page.goto("/?modo=demo");
  const marca = await page.locator(".topbar .balance-logo").boundingBox();
  const cliente = await page.locator(".topbar .client-logo").boundingBox();
  expect(marca && cliente).toBeTruthy();
  expect(marca!.x).toBeLessThan(cliente!.x);                      // la marca propia va primero (esquina izquierda)
  expect(cliente!.height).toBeLessThan(marca!.height);            // el cliente, más pequeño
  await expect(page.getByAltText("Megatiendas")).toBeVisible();
});

test("el tablero muestra los 12 indicadores y las secciones A a F con datos DEMO", async ({ page }) => {
  await page.goto("/?modo=demo");
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
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
    await page.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`modo=${modo}`));
    await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  }
});

test("toda la navegación principal responde y las páginas de captura piden una cuenta de usuario", async ({ page }) => {
  await page.goto("/");
  const links = await page.getByRole("navigation", { name: "Principal" }).getByRole("link").evaluateAll((a) => a.map((x) => ({ href: (x as HTMLAnchorElement).getAttribute("href")!, text: x.textContent!.trim() })));
  expect(links.length).toBeGreaterThanOrEqual(8);
  for (const l of links) {
    const r = await page.goto(l.href);
    expect(r?.status(), `${l.text} (${l.href})`).toBeLessThan(400);
    if (["/estudio", "/parametros", "/integraciones", "/historia"].includes(l.href)) await expect(page, `${l.href} debe pedir una cuenta`).toHaveURL(/\/ingreso\?requiere=1/);
  }
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

test("[anónimo] cabeceras de seguridad y rutas internas sin firma", async ({ request }) => {
  const r = await request.get("/ingreso");
  const h = r.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["strict-transport-security"]).toContain("max-age");
  expect(h["x-powered-by"]).toBeUndefined();
  expect((await request.post("/api/sheets/webhook", { data: "{}" })).status()).toBeGreaterThanOrEqual(401);
  expect((await request.get("/api/sheets/reconcile")).status()).toBe(401);
  expect((await request.get("/api/history/snapshot")).status()).toBe(401);
  expect((await request.get("/api/export/vista-inexistente")).status()).toBe(401); // la puerta de entrada responde antes que la ruta
});

test("sin desbordamiento horizontal y con tema oscuro legible", async ({ page }) => {
  await page.goto("/?modo=demo");
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "la página no debe tener scroll horizontal").toBeLessThanOrEqual(1);
  await page.emulateMedia({ colorScheme: "dark" });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(244, 246, 251)");
});

/* ───── Modo de color (D-98): interruptor del encabezado, que se recuerda, y el texto del encabezado legible con el equipo en oscuro ───── */
const rgb = (c: string) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]; };
const luz = (c: string) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; const [r, g, b] = rgb(c); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contraste = (a: string, b: string) => { const [x, y] = [luz(a), luz(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const pintura = (page: Page) => page.evaluate(() => { const c = (s: string, p: string) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p); return { texto: c(".brand-name", "color"), barra: c(".topbar", "background-color"), cuerpo: c("body", "background-color") }; });
const interruptor = (page: Page) => page.getByRole("switch", { name: "Modo oscuro" });
const atributo = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test("el interruptor del encabezado cambia entre modo claro y oscuro, se recuerda en las demás páginas y la página llega ya pintada", async ({ page }) => {
  await page.goto("/?modo=demo");
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect(await atributo(page)).toBeNull(); // sin elección, la página sigue al equipo (aquí, claro)
  expect(luz((await pintura(page)).cuerpo)).toBeGreaterThan(0.8);
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await atributo(page)).toBe("dark");
  const oscuro = await pintura(page);
  expect(luz(oscuro.cuerpo), "fondo oscuro").toBeLessThan(0.1);
  expect(contraste(oscuro.texto, oscuro.barra), "el texto del encabezado se lee").toBeGreaterThanOrEqual(4.5);
  expect((await page.context().cookies()).find((c) => c.name === "ba_theme")?.value).toBe("dark");
  // se recuerda: al recargar, en otra página y en el HTML que entrega el servidor (sin parpadeo)
  await page.reload();
  expect(await atributo(page)).toBe("dark");
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  await page.goto("/cargos?modo=demo");
  expect(await atributo(page)).toBe("dark");
  const html = await (await page.request.get("/?modo=demo")).text();
  expect(/<html[^>]*data-theme="dark"/.test(html), "el servidor ya entrega el modo oscuro").toBe(true);
  // y vuelve a claro con otro clic
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect(await atributo(page)).toBe("light");
  expect(luz((await pintura(page)).cuerpo)).toBeGreaterThan(0.8);
  expect((await page.context().cookies()).find((c) => c.name === "ba_theme")?.value).toBe("light");
});

test("con el equipo en modo oscuro y sin elección, el encabezado se lee (era el defecto) y el botón lo muestra; al pulsarlo pasa a claro aunque el equipo siga en oscuro", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?modo=demo");
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "true");
  expect(await atributo(page)).toBeNull();
  const p = await pintura(page);
  expect(luz(p.cuerpo)).toBeLessThan(0.1);
  expect(contraste(p.texto, p.barra), "el texto «Estudio de actividades y cargas laborales» debe leerse sobre el fondo oscuro").toBeGreaterThanOrEqual(4.5);
  await interruptor(page).click();
  await expect(interruptor(page)).toHaveAttribute("aria-checked", "false");
  expect(await atributo(page)).toBe("light");
  const c = await pintura(page);
  expect(luz(c.cuerpo), "la elección manda sobre el equipo").toBeGreaterThan(0.8);
  expect(contraste(c.texto, c.barra)).toBeGreaterThanOrEqual(4.5);
  await page.reload();
  expect(await atributo(page)).toBe("light");
});

test("una cookie de modo manipulada se ignora: sin atributo, sin error y sin reflejar su contenido", async ({ page, baseURL }) => {
  for (const valor of ["negro", "dark%3Bx", "%3Cscript%3Ealert(1)%3C%2Fscript%3E", "DARK"]) {
    await page.context().addCookies([{ name: "ba_theme", value: valor, url: baseURL! }]);
    const r = await page.request.get("/?modo=demo");
    expect(r.status(), valor).toBe(200);
    const html = await r.text();
    expect(/<html[^>]*data-theme=/.test(html), `«${valor}» no debe fijar el modo`).toBe(false);
    expect(html.includes("<script>alert(1)"), "no debe reflejar la cookie").toBe(false);
  }
});

for (const ruta of ["/?modo=demo", "/cargos?modo=demo", "/actividades?modo=demo"]) {
  test(`accesibilidad (axe, sin fallas serias ni críticas) en MODO OSCURO elegido con el botón: ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    await interruptor(page).click();
    expect(await atributo(page)).toBe("dark");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(graves.map((v) => `${v.id}: ${v.nodes.length} elemento(s) · ${v.help}`)).toEqual([]);
  });
}

for (const ruta of ["/?modo=demo", "/cargos?modo=demo", "/actividades?modo=demo", "/sedes?modo=demo", "/calculo?modo=demo", "/drill?modo=demo&level=area&area=Cajas"]) {
  test(`accesibilidad (axe, sin fallas serias ni críticas): ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(graves.map((v) => `${v.id}: ${v.nodes.length} elemento(s) · ${v.help}`)).toEqual([]);
  });
}
for (const ruta of ["/ingreso", "/ingreso?modo=invitado"]) {
  test(`[anónimo] accesibilidad (axe, sin fallas serias ni críticas) de la página de ingreso: ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(graves.map((v) => `${v.id}: ${v.nodes.length} elemento(s) · ${v.help}`)).toEqual([]);
  });
}

test("el drill-down baja de nivel con un clic y el comparador de centros de operaciones se exporta", async ({ page }) => {
  await page.goto("/drill?modo=demo");
  await expect(page.getByRole("heading", { name: /Drill-down/ })).toBeVisible();
  await page.getByRole("table").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/level=area/);
  await expect(page.getByRole("navigation", { name: "Ruta del drill-down" })).toContainText("Estudio");
  await page.goto("/sedes?modo=demo");
  await expect(page.getByRole("heading", { name: "Comparador de centros de operaciones" })).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(d.suggestedFilename()).toMatch(/sedes.*\.xlsx$/);
});
test("la política de contenido usa un código distinto por petición, sin 'unsafe-inline' en scripts, y no hay violaciones ni errores en consola", async ({ page, request }) => {
  const csp = async () => (await request.get("/ingreso")).headers()["content-security-policy"];
  const [a, b] = [await csp(), await csp()];
  expect(a).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(a).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(a).not.toMatch(/style-src 'self'[^;]*unsafe-inline/);
  expect(a).toContain("frame-ancestors 'none'");
  expect(a).toContain("form-action");
  expect(a).not.toBe(b); // el nonce cambia en cada petición
  const problemas: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problemas.push(m.text()); });
  page.on("pageerror", (e) => problemas.push(e.message));
  for (const ruta of ["/?modo=demo", "/sedes?modo=demo", "/drill?modo=demo"]) { await page.goto(ruta); await page.waitForLoadState("networkidle"); }
  expect(problemas).toEqual([]);
  const h = (await request.get("/ingreso")).headers();
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["cross-origin-resource-policy"]).toBe("same-origin");
});
test("la pestaña de la hoja 4a muestra las columnas calculadas con los encabezados del libro y se exporta", async ({ page }) => {
  await page.goto("/calculo?modo=demo");
  await expect(page.getByRole("heading", { name: "Cálculo de tiempos" })).toBeVisible();
  await page.getByText("Detalle avanzado: todas las columnas del cálculo").click(); // el detalle completo está plegado por defecto
  for (const h of ["Ejecuciones por semana", "Horas/sem TOTALES de la actividad en el centro de operaciones", "Horas/mes equivalentes"]) await expect(page.getByRole("columnheader", { name: h })).toBeVisible();
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Exportar Excel" }).click()]);
  expect(d.suggestedFilename()).toMatch(/calculo.*\.xlsx$/);
});
test("«Resultados» (D-100) no se ofrece en la demostración: ni en el menú ni abriendo sus direcciones", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByRole("navigation", { name: "Principal" });
  await expect(menu.getByRole("button", { name: "Resultados" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Agente de IA" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Dotación requerida" })).toHaveCount(0);
  for (const ruta of ["/resultados/dotacion", "/resultados/reparto", "/resultados/agente", "/agente"]) {
    await page.goto(ruta);
    await expect(page, ruta).toHaveURL(/\/ingreso\?requiere=1/);
  }
});
test("las listas se muestran de 10 en 10, con «Filas por página» y navegación entre páginas", async ({ page }) => {
  await page.goto("/calculo?modo=demo");
  const filas = page.getByRole("region", { name: "Tabla desplazable" }).first().locator("tbody tr");
  await expect(filas).toHaveCount(10);
  await expect(page.getByText("Filas por página:").first()).toBeVisible();
  await expect(page.getByText(/^1–10 de \d+$/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Página anterior" }).first()).toBeDisabled();
  await page.getByRole("button", { name: "Página siguiente" }).first().click();
  await expect(page.getByText(/^11–15 de 15$/).first()).toBeVisible();
  await page.getByLabel("Filas por página:").first().selectOption("25");
  await expect(page.getByText(/^1–15 de 15$/).first()).toBeVisible();
});
test("[anónimo] la política de privacidad es pública y se enlaza desde la página de ingreso (la pide Google para publicar el inicio de sesión)", async ({ page }) => {
  await page.goto("/ingreso");
  await page.getByRole("link", { name: "Política de privacidad" }).click();
  await expect(page).toHaveURL(/\/privacidad$/);
  await expect(page.getByRole("heading", { name: "Política de privacidad" })).toBeVisible();
  await expect(page.getByText("Política de datos de usuario de los servicios de API de Google")).toBeVisible();
});
