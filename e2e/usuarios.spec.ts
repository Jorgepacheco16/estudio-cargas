import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Usuarios, roles e invitaciones (D-91) en un navegador de verdad, con la autenticación SIMULADA (tests/support/mock-auth.ts) y una base de datos de pruebas:
 * el Super usuario crea un rol, invita a una persona, ella crea su clave y entra, ve solo lo que su rol permite, y el Super usuario la ve «como ella» (solo lectura).
 * Corre en el trabajo e2e-usuarios del CI (ver ci.yml); localmente exige la autenticación simulada, la siembra (e2e/support/seed-usuarios.ts) y la app compilada con
 * NEXT_PUBLIC_SUPABASE_URL apuntando a la autenticación simulada.
 */
test.describe.configure({ mode: "serial" });

const listo = async (p: Page, name: string) => { await p.getByRole("heading", { name }).first().waitFor(); await p.waitForLoadState("networkidle"); };
let admin: Page, ana: Page, link = "";

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

test("la persona escribe su nombre en «Mi cuenta» y se le ve con él (encabezado y lista de usuarios)", async () => {
  await ana.goto("/cuenta");
  await listo(ana, "Mi cuenta");
  await ana.fill("#c-nombre", "Ana Pérez");
  await ana.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(ana.getByText("Nombre guardado.")).toBeVisible();
  await expect(ana.locator(".account-mail")).toHaveText("Ana Pérez");
  await expect(ana.locator(".account-label")).toContainText("ana@prueba.co");
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
