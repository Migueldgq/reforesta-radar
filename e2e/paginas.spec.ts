import path from "node:path";
import { expect, expectNoCrash, test } from "./fixtures";

/** Smoke level: each page renders its main content without errors (member `miembro`, read-only). */

test("Empresas lists the company programmes", async ({ as, run }) => {
  const page = await as("miembro");
  await page.goto("/empresas");
  await expect(page.getByRole("heading", { name: "Empresas y fundaciones", level: 1 })).toBeVisible();
  await expect(page.getByText(run.seed.rsc[0].split(" — ")[0]).first()).toBeVisible();
  await expectNoCrash(page);
});

test("Fuentes shows the sources of the last load", async ({ as }) => {
  const page = await as("miembro");
  await page.goto("/fuentes");
  await expect(page.getByRole("heading", { name: "Fuentes", level: 1 })).toBeVisible();
  await expect(page.getByText("BDNS").first()).toBeVisible();
  await expect(page.getByText("Empresas y fundaciones").first()).toBeVisible();
  await expectNoCrash(page);
});

test("Perfil shows the team's scoring settings", async ({ as }) => {
  const page = await as("miembro");
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Perfil", level: 1 })).toBeVisible();
  await expect(page.getByText("Líneas de trabajo").first()).toBeVisible();
  await expect(page.getByText("Palabras que os interesan").first()).toBeVisible();
  await expectNoCrash(page);
});

test("Analizar PDF refuses a file that is not a PDF and reads a real one", async ({ as }) => {
  const page = await as("miembro");
  await page.goto("/analizar");
  await expect(page.getByRole("heading", { name: "Analizar PDF", level: 1 })).toBeVisible();
  const input = page.locator("input[type=file]");

  await input.setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("no soy un PDF") });
  await expect(page.getByText("«notas.txt» no es un PDF. Aquí solo se pueden analizar bases en PDF.")).toBeVisible();

  // The Madrid order (data/samples/): read on the server by rules, offline, and scored from its own text.
  await input.setInputFiles(path.join(__dirname, "..", "data", "samples", "comunidad-madrid-orden-1689-2026.pdf"));
  await expect(page.getByRole("heading", { level: 2, name: /^Orden 1689\/2026/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("comunidad-madrid-orden-1689-2026.pdf")).toBeVisible();
  await expect(page.getByTitle(/^\d+ de 100$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Motivos", level: 3 })).toBeVisible();
  await expectNoCrash(page);
});
