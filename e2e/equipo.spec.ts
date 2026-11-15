import { expect, expectNoCrash, failOnPageErrors, test } from "./fixtures";

/** Equipo: only admins manage people. The invited person is new on every attempt (unique e-mail). */

test("an admin invites someone, who opens the one-time link, sets a password and signs in", async ({ as, browser, run }, info) => {
  const email = `e2e-nuevo-${run.runId}-${info.retry}@example.org`;
  const password = `clave-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const admin = await as("admin");
  await admin.goto("/equipo");
  await expect(admin.getByRole("heading", { name: "Equipo", level: 1 })).toBeVisible();

  await admin.getByRole("button", { name: "Invitar" }).click();
  const form = admin.getByRole("dialog", { name: "Invitar a alguien" });
  await form.getByLabel("Correo electrónico").fill(email);
  await form.getByLabel(/^Nombre/).fill("Nuria Nueva");
  await form.getByRole("button", { name: "Crear invitación" }).click();

  const ready = admin.getByRole("dialog", { name: "Invitación lista" });
  const link = await ready.getByLabel("Enlace").inputValue();
  expect(link).toMatch(/\/invitacion\/[^/]+$/);
  await ready.getByRole("button", { name: "Hecho" }).click();
  await expect(admin.getByRole("region", { name: "Enlaces pendientes" })).toContainText(email);

  // A fresh browser, nobody signed in: the link from the invitation.
  const fresh = await browser.newContext();
  const page = await fresh.newPage();
  failOnPageErrors(page);
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "Crear tu cuenta" })).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toHaveValue(email);
  await expect(page.getByLabel("Tu nombre")).toHaveValue("Nuria Nueva");
  await page.getByLabel("Contraseña nueva").fill(password);
  await page.getByLabel("Repite la contraseña").fill(password);
  await page.getByRole("button", { name: "Crear cuenta y entrar" }).click();
  await expect(page.getByRole("heading", { name: "Convocatorias", level: 1 })).toBeVisible();

  // The link is single-use.
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();

  // Signing in again with the new password works.
  await fresh.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Convocatorias", level: 1 })).toBeVisible();
  await expectNoCrash(page);
  await fresh.close();
});

test("a member cannot open Equipo and does not see it in the menu", async ({ as }) => {
  const page = await as("miembro");
  await page.goto("/equipo");
  await expect(page.getByRole("heading", { name: "Solo para administración" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Invitar" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Menú del radar" }).getByRole("link", { name: "Equipo" })).toHaveCount(0);
  // The API refuses too, whatever the page shows.
  expect((await page.request.get("/api/team")).status()).toBe(403);
});
