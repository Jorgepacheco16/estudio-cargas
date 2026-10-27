import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de navegador (Fase 7/§18). Corren contra la aplicación COMPILADA (`next build` + `next start`) en el puerto 3100.
 * Las pruebas públicas entran como invitado con DEMO_USER / E2E_DEMO_PASSWORD (el CI los genera al azar en cada ejecución; ver ci.yml).
 * Las pruebas con sesión (e2e/sesion.spec.ts) solo corren si E2E_SESSION=1 y hay claves en .env.local; no corren en CI.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 }, // las acciones con redirección esperan a que se renderice la página destino (varias consultas a la base remota)
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", trace: "retain-on-failure", locale: "es-CO", timezoneId: "America/Bogota" },
  // Con E2E_BASE_URL se prueba un despliegue existente (humo de Preview/Producción) y no se levanta servidor local.
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run start -- -p 3100", url: "http://localhost:3100/ingreso", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "movil", use: { ...devices["Pixel 7"] }, testIgnore: /sesion\.spec\.ts/ },
  ],
});
