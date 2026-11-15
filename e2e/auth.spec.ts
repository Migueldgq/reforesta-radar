import { request } from "@playwright/test";
import { drawer, expect, failOnPageErrors, test } from "./fixtures";

/** Signing in and out with the account `acceso` (its own, so its sessions and failed attempts touch nobody else). */

async function signIn(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("a protected page without a session goes to /login and comes back after signing in", async ({ page, run }) => {
  await page.goto("/seguimiento");
  await expect(page).toHaveURL(/\/login\?next=%2Fseguimiento$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();

  const { email, password } = run.accounts.acceso;
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/seguimiento$/);
  await expect(page.getByRole("heading", { name: "Seguimiento" })).toBeVisible();
});

test("a wrong password shows the Spanish error and keeps the person on the login page", async ({ page, run }) => {
  await page.goto("/login");
  await signIn(page, run.accounts.acceso.email, "no-es-la-contraseña");
  await expect(page.getByRole("alert").filter({ hasText: "Correo o contraseña incorrectos." })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Contraseña")).toHaveValue("");
});

test("sign in, then sign out from the account menu", async ({ page, run }) => {
  failOnPageErrors(page);
  const { email, password, name } = run.accounts.acceso;
  await page.goto("/login");
  await signIn(page, email, password);
  await expect(page.getByRole("heading", { name: "Convocatorias" })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`^Tu cuenta: ${name}`) }).click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("a session that ends mid-use sends the person to /login saying the change was not saved", async ({ page, run, baseURL }) => {
  failOnPageErrors(page);
  const { email, password } = run.accounts.acceso;
  await page.goto("/login");
  await signIn(page, email, password);
  await expect(page.getByRole("heading", { name: "Convocatorias" })).toBeVisible();
  await page.goto(`/?c=${encodeURIComponent(run.seed.search)}`);
  await expect(drawer(page).getByRole("radio", { name: "En estudio" })).toBeVisible();

  // The session ends on the server (as if it expired), while the browser still holds the cookie.
  const cookie = (await page.context().cookies()).find((c) => c.name === "radar_session")!;
  const other = await request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `radar_session=${cookie.value}`, "X-Radar-CSRF": "1" } });
  expect((await other.post("/api/auth/logout")).ok()).toBe(true);
  await other.dispose();

  // The next change gets a 401: it is not saved, and the login page says so.
  await drawer(page).getByRole("radio", { name: "En estudio" }).click();
  await expect(page).toHaveURL(/\/login\?.*caducada=1&cambio=1/);
  await expect(page.getByRole("status").filter({ hasText: "Tu sesión ha caducado. Vuelve a entrar; el último cambio no se guardó." })).toBeVisible();
});
