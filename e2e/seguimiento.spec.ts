import type { Page } from "@playwright/test";
import { drawer, expect, expectNoCrash, test } from "./fixtures";

/**
 * The shared tracking board. Only this file changes the board: the call `track` (status, note, assignee, vote) with
 * the accounts tablero1 and tablero2, and it reads the seeded `gone` card.
 */

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) });

test("tracking a call in the drawer is shared with the rest of the team", async ({ as, run }) => {
  const title = run.seed.titles[run.seed.track];
  const note = `Revisar las bases antes del viernes (${run.runId})`;
  const teresa = await as("tablero1");
  await teresa.goto(`/?c=${encodeURIComponent(run.seed.track)}`);
  const d = drawer(teresa);
  await expect(d.getByRole("heading", { name: title })).toBeVisible();

  const saved = (path: string) => teresa.waitForResponse((r) => r.url().includes(path) && r.request().method() !== "GET" && r.ok());
  await Promise.all([saved("/api/board/"), d.getByRole("radio", { name: "En estudio" }).click()]);
  await expect(d.getByRole("radio", { name: "En estudio" })).toHaveAttribute("aria-checked", "true");

  await d.getByRole("combobox", { name: "Responsable" }).click();
  await Promise.all([saved("/api/board/"), teresa.getByRole("option", { name: run.accounts.tablero2.name }).click()]);
  await expect(d.getByRole("combobox", { name: "Responsable" })).toHaveText(run.accounts.tablero2.name);

  await d.getByRole("textbox", { name: "Nueva nota" }).fill(note);
  await Promise.all([saved("/notes"), d.getByRole("button", { name: "Añadir nota" }).click()]);
  await expect(d.getByRole("region", { name: /^Notas/ })).toContainText(note);

  await Promise.all([saved("/api/votes/"), d.getByRole("button", { name: "Nos sirve", exact: true }).click()]);
  await expect(d.getByRole("button", { name: "Nos sirve", exact: true })).toHaveAttribute("aria-pressed", "true");

  // On the board, in the «En estudio» column.
  await teresa.keyboard.press("Escape");
  await teresa.goto("/seguimiento");
  await expect(column(teresa, "En estudio").getByRole("button", { name: title })).toBeVisible();
  await expectNoCrash(teresa);

  // Another member, signed in on their own, sees the same board, note, assignee and vote.
  const tomas = await as("tablero2");
  await tomas.goto("/seguimiento");
  const card = column(tomas, "En estudio").getByRole("button", { name: title });
  await expect(card).toBeVisible();
  await card.click();
  const d2 = drawer(tomas);
  await expect(d2.getByRole("radio", { name: "En estudio" })).toHaveAttribute("aria-checked", "true");
  await expect(d2.getByRole("combobox", { name: "Responsable" })).toHaveText(run.accounts.tablero2.name);
  await expect(d2.getByRole("region", { name: /^Notas/ })).toContainText(note);
  await expect(d2.getByRole("region", { name: /^Notas/ })).toContainText(run.accounts.tablero1.name);
  const votes = d2.getByRole("region", { name: "¿Os sirve esta convocatoria?" });
  await expect(votes).toContainText("Nos sirve: 1");
  await expect(votes).toContainText(`${run.accounts.tablero1.name}: nos sirve`);
  await expectNoCrash(tomas);
});

// Regression: a board card whose call left the sources sent Drawer.tsx into a render loop (49e3e6b) and crashed
// the app. The seed puts such a card in «En estudio».
test("a board card whose call is gone from the sources opens without crashing", async ({ as, run }) => {
  const title = run.seed.titles[run.seed.gone];
  const page = await as("tablero1");
  await page.goto("/seguimiento");
  const col = column(page, "En estudio");
  await expect(col.getByText("Ya no aparece en las fuentes")).toBeVisible();
  await col.getByRole("button", { name: title }).click();

  const d = drawer(page);
  await expect(d.getByText("Guardada en el tablero del equipo")).toBeVisible();
  await expect(d.getByRole("heading", { name: title })).toBeVisible();
  await expect(d.getByText("Ya no aparece en las fuentes")).toBeVisible();
  await expect(d.getByRole("radio", { name: "En estudio" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);

  // The same through a shared link, straight into the drawer.
  await page.goto(`/seguimiento?c=${encodeURIComponent(run.seed.gone)}`);
  await expect(drawer(page).getByText("Guardada en el tablero del equipo")).toBeVisible();
  await expectNoCrash(page);
});
