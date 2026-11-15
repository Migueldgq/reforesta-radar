import type { Page } from "@playwright/test";
import { drawer, expect, expectNoCrash, test } from "./fixtures";

/**
 * Inicio as the member `miembro`. Data: backend/tests/e2e_seed.py (12 opportunities, 2 sources, plus one call the
 * «Revisión por IA» discarded). Serial: the «Sí encaja» test brings that call back for the whole team (and then undoes
 * it), which would change the counts the other tests here check.
 */
test.describe.configure({ mode: "serial" });

const list = (page: Page) => page.getByRole("region", { name: "Convocatorias" });
const total = (page: Page, n: number) => list(page).getByText(new RegExp(`^${n} convocatorias?$`));

async function openInicio(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Convocatorias", level: 1 })).toBeVisible();
  await expect(page.getByText(/^12 oportunidades de 2 fuentes/)).toBeVisible();
}

/** A faceted filter of the bar above the table (a popover with a list of options). */
async function pickFacet(page: Page, facet: string, option: RegExp) {
  await list(page).locator("button[aria-haspopup=dialog]", { hasText: facet }).click();
  await page.getByRole("option", { name: option }).click();
  await page.keyboard.press("Escape");
}

test("the list loads with the seeded calls", async ({ as, run }) => {
  const page = await as("miembro");
  await openInicio(page);
  await expect(list(page).getByRole("tab", { name: /Todas/ })).toHaveText(/12/);
  await expect(list(page).getByRole("table")).toContainText(run.seed.titles[run.seed.search]);
  await expectNoCrash(page);
});

test("a filter and the search narrow the list", async ({ as, run }) => {
  const page = await as("miembro");
  await openInicio(page);
  await list(page).getByRole("tab", { name: /Todas/ }).click();
  await expect(total(page, 12)).toBeVisible();

  await pickFacet(page, "Territorio", /^Comunitat Valenciana/);
  await expect(total(page, 1)).toBeVisible();
  await expect(list(page).getByText("Territorio: Comunitat Valenciana")).toBeVisible();
  await list(page).getByRole("button", { name: "Quitar filtro: Territorio: Comunitat Valenciana" }).click();
  await expect(total(page, 12)).toBeVisible();

  await list(page).getByRole("searchbox", { name: "Buscar" }).fill("anfibios");
  await expect(total(page, 1)).toBeVisible();
  const rows = list(page).getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2); // header + the one match
  await expect(rows.nth(1)).toContainText(run.seed.titles[run.seed.search]);
});

test("a row opens the drawer with its score, reasons and warnings", async ({ as }) => {
  const page = await as("miembro");
  await openInicio(page);
  await pickFacet(page, "Territorio", /^Comunitat Valenciana/);
  await list(page).getByRole("button", { name: /voluntariado ambiental \(PIFVOL 2026\)/ }).click();

  const d = drawer(page);
  await expect(d.getByRole("heading", { name: /voluntariado ambiental/i })).toBeVisible();
  const fit = d.getByRole("region", { name: "¿Encaja?" });
  await expect(fit).toContainText(/\d+ · Encaje medio/);
  await expect(fit).toContainText("Concurrencia competitiva: cualquier entidad que cumpla requisitos puede optar."); // a reason
  await expect(fit).toContainText("Convocatoria de Comunitat Valenciana: suele exigir sede o actuación allí."); // a warning
  await expectNoCrash(page);
});

test("the call Reforesta already won shows its past editions", async ({ as, run }) => {
  const page = await as("miembro");
  await openInicio(page);
  await list(page).getByRole("tab", { name: /Próximas ediciones/ }).click();
  const row = list(page).getByRole("row").filter({ hasText: "Ya la ganasteis" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button").first().click();

  const d = drawer(page);
  await expect(d.getByRole("heading", { level: 2 })).toHaveText(/proyectos ambientales 2026/i);
  const history = d.getByRole("region", { name: "Ediciones anteriores" });
  await expect(history).toContainText("Reforesta la ganó en 2025, 2024 y 2022");
  const editions = history.getByRole("list", { name: "Ediciones anteriores en BDNS" }).getByRole("listitem");
  await expect(editions.filter({ hasText: "La ganasteis" })).toHaveCount(3);
  await expect(page).toHaveURL(new RegExp(`[?&]c=${encodeURIComponent(run.seed.won)}`));
});

test("a deep link ?c=<id> opens that call's drawer, and closing it clears the link", async ({ as, run }) => {
  const page = await as("miembro");
  await page.goto(`/?c=${encodeURIComponent(run.seed.search)}`);
  await expect(drawer(page).getByRole("heading", { name: run.seed.titles[run.seed.search] })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]c=/);
  await expectNoCrash(page);
});

/* ---------- «Revisión por IA» (seeded verdicts; no model is called) ---------- */

const discardedControl = (page: Page) => list(page).getByRole("button", { name: /^Descartadas por la IA/ });

test("the calls the AI review discarded are apart, with its reason", async ({ as, run }) => {
  const page = await as("miembro");
  await openInicio(page);
  const title = run.seed.titles[run.seed.discarded];
  await expect(list(page).getByRole("table")).not.toContainText(title);
  await expect(discardedControl(page)).toHaveText(/Descartadas por la IA\s*1/);
  await discardedControl(page).click();
  const apart = page.getByTestId("descartadas-ia");
  await expect(apart).toContainText("Revisión por IA: Es voluntariado social, no ambiental.");
  await apart.getByRole("button", { name: title }).click();

  const review = drawer(page).getByRole("region", { name: "Revisión por IA" });
  await expect(review).toContainText("No encaja");
  await expect(review).toContainText("Es voluntariado social, no ambiental.");
  await expect(review).toContainText("No cambia la nota. Por eso no sale en la lista.");
  await expect(review.getByRole("button", { name: "Sí encaja" })).toBeVisible();
  await expectNoCrash(page);
});

test("a doubtful verdict is a chip in the list and a section in the drawer", async ({ as, run }) => {
  const page = await as("miembro");
  await openInicio(page);
  await list(page).getByRole("tab", { name: /Todas/ }).click();
  const row = list(page).getByRole("row").filter({ hasText: "Revisión por IA: dudosa" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button").first().click();
  const review = drawer(page).getByRole("region", { name: "Revisión por IA" });
  await expect(review).toContainText("Dudosa");
  await expect(page).toHaveURL(new RegExp(`[?&]c=${encodeURIComponent(run.seed.doubt)}`));
  // the rules' reasons stay apart, under «¿Encaja?»
  await expect(drawer(page).getByRole("region", { name: "¿Encaja?" })).not.toContainText("Revisión por IA");
});

test("«Sí encaja» brings a discarded call back to the list, and removing the vote takes it out again", async ({ as, run }) => {
  const page = await as("miembro");
  await page.goto(`/?c=${encodeURIComponent(run.seed.discarded)}`);
  const review = drawer(page).getByRole("region", { name: "Revisión por IA" });
  await review.getByRole("button", { name: "Sí encaja" }).click();
  await expect(review).toContainText("Sigue en la lista porque alguien del equipo votó «Nos sirve».");
  await expect(drawer(page).getByRole("button", { name: "Nos sirve" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^13 oportunidades de 2 fuentes/)).toBeVisible();
  await expect(list(page).getByRole("table")).toContainText(run.seed.titles[run.seed.discarded]);
  await expect(discardedControl(page)).toHaveCount(0);

  // a fresh page agrees (the vote is the team's, saved by the API)
  await page.reload();
  await expect(page.getByText(/^13 oportunidades de 2 fuentes/)).toBeVisible();

  // undo, so the seeded data is as it was
  await page.goto(`/?c=${encodeURIComponent(run.seed.discarded)}`);
  await drawer(page).getByRole("button", { name: "Quitar mi voto" }).click();
  await expect(drawer(page).getByRole("region", { name: "Revisión por IA" }).getByRole("button", { name: "Sí encaja" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^12 oportunidades de 2 fuentes/)).toBeVisible();
  await expect(discardedControl(page)).toHaveText(/Descartadas por la IA\s*1/);
  await expectNoCrash(page);
});
