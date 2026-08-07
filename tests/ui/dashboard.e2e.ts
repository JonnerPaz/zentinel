import { test, expect, type Page } from "@playwright/test";

const USER = "admin";
const PASS = "secret";

async function login(page: Page): Promise<void> {
  await page.goto("/api/monitoring/");
  await expect(page.locator(".login-overlay")).toBeVisible();
  await page.fill('input[placeholder="Usuario"]', USER);
  await page.fill('input[placeholder="Contraseña"]', PASS);
  await page.click("button:has-text('Ingresar')");
  await expect(page.locator(".login-overlay")).toBeHidden({ timeout: 10000 });
}

test.describe("Dashboard de monitoreo (SPA vía CDN)", () => {
  test("login, métricas del dashboard y auto-refresh", async ({ page }) => {
    // Genera tráfico para que existan métricas
    await page.request.get("/api/users");
    await page.request.get("/api/users");
    await page.request.post("/api/users", { data: { name: "E2E" } });
    await page.request.get("/api/error-500");

    await login(page);

    // Cards de resumen visibles con valores numéricos
    const totalCard = page.locator(".card", { hasText: "Total Requests" });
    await expect(totalCard).toBeVisible();
    await expect(totalCard.locator(".value")).not.toHaveText("—");

    await expect(page.locator(".percentile-card", { hasText: "p50" })).toBeVisible();
    await expect(page.locator(".percentile-card", { hasText: "p99" })).toBeVisible();

    // Gráficos de Chart.js renderizados
    await expect(page.locator("#methodChartCanvas")).toBeVisible();
    await expect(page.locator("#statusDonutCanvas")).toBeVisible();

    // Tablas de top endpoints y errores
    await expect(page.locator(".section-title", { hasText: "🏆 Top 10 Endpoints" })).toBeVisible();
    await expect(page.locator(".section-title", { hasText: "Errores por Endpoint" })).toBeVisible();

    // Requests recientes con filas clicables
    const recentTable = page.locator(".section-title", { hasText: "Requests Recientes" });
    await expect(recentTable).toBeVisible();
    await expect(page.locator("tr.row-link").first()).toBeVisible();
  });

  test("vista Requests: filtros, filas y modal de detalle", async ({ page }) => {
    await page.request.get("/api/users");
    await login(page);

    await page.click("button:has-text('Requests')");

    // Filtro por método GET
    await page.locator(".filter-field", { hasText: "Método" }).locator("select").selectOption("GET");
    await page.click("button:has-text('Buscar')");

    await expect(page.locator("tbody tr.row-link").first()).toBeVisible({ timeout: 10000 });

    // Detalle: click en la primera fila abre el modal
    await page.locator("tbody tr.row-link").first().click();
    await expect(page.locator(".detail-modal")).toBeVisible();
    // Nota: el body de una respuesta puede contener el HTML del dashboard
    // (que incluye la cadena "Request Headers"); por eso anclamos al <h4>.
    await expect(page.locator(".detail-section h4", { hasText: "Request Headers" })).toBeVisible();
    await expect(page.locator(".detail-section h4", { hasText: "Response Body" }).first()).toBeVisible();

    // Cerrar modal
    await page.click(".detail-close");
    await expect(page.locator(".detail-modal")).toBeHidden();
  });

  test("vista Logs: listado con badge de nivel", async ({ page }) => {
    await login(page);
    await page.click("button:has-text('Logs')");

    const table = page.locator(".table-container", { hasText: "Logs" });
    await expect(table).toBeVisible();
    // Sin logs todavía o con logs: el header siempre se muestra
    await expect(table.locator("thead")).toBeVisible();

    // El filtro de nivel existe
    await expect(page.locator(".filter-field", { hasText: "Nivel" }).locator("select")).toBeVisible();
  });

  test("logout vuelve al login", async ({ page }) => {
    await login(page);
    await page.click("button:has-text('Cerrar sesión')");
    await expect(page.locator(".login-overlay")).toBeVisible();
  });

  test("credenciales inválidas muestran error", async ({ page }) => {
    await page.goto("/api/monitoring/");
    await page.fill('input[placeholder="Usuario"]', "admin");
    await page.fill('input[placeholder="Contraseña"]', "incorrecta");
    await page.click("button:has-text('Ingresar')");
    await expect(page.locator(".error-msg")).toContainText("Credenciales inválidas");
    await expect(page.locator(".login-overlay")).toBeVisible();
  });
});
