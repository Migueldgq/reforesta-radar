import { readFileSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Browser, type Page } from "@playwright/test";

/**
 * Accounts of one run (created by global-setup.ts). Each spec file uses its own, so files can run in parallel
 * without seeing each other's sessions; data a test changes belongs to that file (see backend/tests/e2e_seed.py).
 */
export const ACCOUNTS = {
  admin: { name: "Ana Admin", role: "admin" },
  miembro: { name: "Mario Miembro", role: "member" },
  acceso: { name: "Aurora Acceso", role: "member" },
  tablero1: { name: "Teresa Tablero", role: "member" },
  tablero2: { name: "Tomás Tablero", role: "member" },
  agente: { name: "Agustina Agente", role: "member" },
} as const;
export type AccountKey = keyof typeof ACCOUNTS;

export interface Run {
  runId: string;
  seed: { won: string; search: string; track: string; gone: string; titles: Record<string, string>; rsc: string[] };
  accounts: Record<AccountKey, { email: string; password: string; name: string }>;
}

export const AUTH_DIR = path.join(__dirname, ".auth");
export const statePath = (key: AccountKey) => path.join(AUTH_DIR, `${key}.json`);

let cached: Run | null = null;
export function run(): Run {
  cached ??= JSON.parse(readFileSync(path.join(AUTH_DIR, "run.json"), "utf8")) as Run;
  return cached;
}

/** A page signed in as `key`, in its own browser context. Fails the test on any uncaught error in the page. */
export async function pageAs(browser: Browser, key: AccountKey): Promise<Page> {
  const context = await browser.newContext({ storageState: statePath(key) });
  const page = await context.newPage();
  failOnPageErrors(page);
  return page;
}

/** Uncaught exceptions (a React render loop throws "Maximum update depth exceeded") fail the test at the end. */
export function failOnPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Maximum update depth|Too many re-renders/.test(m.text())) errors.push(m.text());
  });
  pageErrors.set(page, errors);
}
const pageErrors = new WeakMap<Page, string[]>();

export function expectNoPageErrors(page: Page) {
  expect(pageErrors.get(page) ?? [], "uncaught errors in the page").toEqual([]);
}

/** The crash screen of the app (src/components/radar/CrashScreen.tsx) must never show. */
export async function expectNoCrash(page: Page) {
  await expect(page.getByRole("heading", { name: "Algo ha fallado en esta pantalla" })).toHaveCount(0);
  expectNoPageErrors(page);
}

/** Opens the detail drawer of a call; returns the drawer (a dialog named by the call's title). */
export function drawer(page: Page) {
  return page.getByRole("dialog");
}

export const test = base.extend<{ run: Run; as: (key: AccountKey) => Promise<Page> }>({
  // (`provide` is Playwright's `use`, renamed so the React hooks lint rule does not mistake it for React's.)
  run: async ({}, provide) => provide(run()),
  /** `await as("admin")`: a page signed in as that account, in its own context, closed after the test. */
  as: async ({ browser }, provide) => {
    const pages: Page[] = [];
    await provide(async (key) => {
      const page = await pageAs(browser, key);
      pages.push(page);
      return page;
    });
    await Promise.all(pages.map((p) => p.context().close()));
  },
});
export { expect };
