// SPDX-License-Identifier: Apache-2.0
// The main flow of the dashboard with the fake bot: register with the confirmation link (from the test hook that
// keeps the mails), connect the fake room with the code, switch a module on, save settings, create a raid event.
import { expect, test, type Page } from "@playwright/test";

async function registered(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.org`;
  await page.goto("/register");
  await page.getByLabel(/^(E-mail|E-Mail)$/).fill(email);
  await page.getByLabel(/^(Password|Passwort)$/).fill("a long enough password");
  await page.getByRole("button", { name: /Create an account|Konto anlegen/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  const mails = (await (await page.request.get("/api/test/mails")).json()) as { to: string; text: string }[];
  const link = mails.filter((m) => m.to === email).at(-1)!.text.match(/https?:\/\/\S+\/confirm\?token=[\w-]+/)![0];
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("register, connect a room, configure modules and plan a raid", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lang", "en"));
  await registered(page);

  await page.getByRole("button", { name: "Connect a room" }).click();
  const command = (await page.getByTestId("connect-command").textContent())!.trim();
  expect(command).toMatch(/^\/connect [A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const hook = await page.request.post("/api/test/connect", { data: { code: command.split(" ")[1] }, headers: { origin: new URL(page.url()).origin } });
  expect((await hook.json()).answer).toContain("Connected");
  await page.getByRole("link", { name: "Fake room" }).click();

  await page.getByRole("switch", { name: /Welcome/ }).check();
  await expect(page.getByRole("switch", { name: "Welcome: On" })).toBeChecked();

  await page.getByRole("link", { name: /^Welcome/ }).first().click();
  await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "#general" });
  await page.getByRole("textbox", { name: "Welcome message" }).fill("Hello {user}!");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Welcome message" })).toHaveValue("Hello {user}!");

  await page.getByRole("link", { name: /^Raid helper/ }).click();
  await page.getByRole("checkbox", { name: "Enabled" }).check();
  await page.getByRole("combobox", { name: "Default channel for events" }).selectOption({ label: "#raids" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  const events = page.getByRole("region", { name: "Events" });
  await events.getByRole("button", { name: "+ New" }).click();
  // Unique per run: the chromium and mobile projects share the fake room and run at the same time.
  const title = `Molten Core ${Date.now().toString(36)}`;
  await events.getByRole("textbox", { name: "Title" }).fill(title);
  await events.getByLabel(/^Start/).fill("2030-01-10T20:00");
  await events.getByRole("spinbutton", { name: "Raid size (0 = any)" }).fill("20");
  await events.getByRole("button", { name: "Save" }).click();
  const rowOf = events.getByRole("row").filter({ has: page.getByRole("cell", { name: title, exact: true }) });
  await expect(rowOf).toBeVisible();
  await expect(rowOf.getByRole("cell", { name: "0/20" })).toBeVisible();
});

test("the public leaderboard is off by default", async ({ page }) => {
  await page.goto("/leaderboard/1");
  await expect(page.getByRole("alert")).toBeVisible();
});
