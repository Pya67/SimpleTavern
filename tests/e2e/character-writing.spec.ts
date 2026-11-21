import { expect, test } from "@playwright/test";

test("character field drafts use the selected model and apply only on confirmation", async ({ page }) => {
  let characterId: string | undefined;
  const settings = await page.request.post("/api/rpc/settings.get", { data: {} });
  expect(settings.ok()).toBeTruthy();
  test.skip(!(await settings.json()).data.mock, "Requires the mock provider to avoid live generation charges.");

  try {
    await page.route("**/api/rpc/settings.get", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      // The development database can have a saved filter that hides the mock provider.
      body.data.ui.modelProviders = [];
      await route.fulfill({ response, json: body });
    });
    await page.goto("/characters/new");
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Mira the cartographer");
    const description = page.getByLabel("Description", { exact: true });
    await description.fill("{{char}} maps  lost trails.");
    await page.getByRole("button", { name: "AI for Description", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: /AI writing/ });
    await expect(dialog.getByRole("button", { name: "Improve", exact: true })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("group", { name: "Model", exact: true }).getByRole("button").click();
    await page.getByPlaceholder("Search models…").fill("tavern-flash");
    await page.getByRole("option", { name: /Mock · Flash/ }).first().click();

    const generate = dialog.getByRole("button", { name: "Generate", exact: true });
    const preview = dialog.getByRole("region", { name: "Draft preview" });
    const request = page.waitForRequest((request) => request.url().endsWith("/api/rpc/characters.draftField"));
    await generate.click();
    expect((await request).postDataJSON()).toMatchObject({ field: "description", mode: "improve", modelId: "mock/tavern-flash" });
    await expect(preview).toContainText("{{char}} maps lost trails.");
    await expect(description).toHaveValue("{{char}} maps  lost trails.");
    await dialog.getByRole("button", { name: "Use draft for Description" }).click();
    await expect(description).toHaveValue("{{char}} maps lost trails.");

    await page.getByRole("button", { name: "AI for Tags" }).click();
    await dialog.getByRole("textbox", { name: "Who is the character?" }).fill("Mira, an original fantasy cartographer.");
    await generate.click();
    await expect(preview).toContainText("fantasy, travel, mystery");
    await dialog.getByRole("button", { name: "Use draft for Tags" }).click();

    await page.getByRole("tab", { name: "Examples" }).click();
    await page.getByRole("button", { name: "AI for Example dialogue" }).click();
    await expect(dialog.getByRole("button", { name: "Write for me" })).toHaveAttribute("aria-pressed", "true");
    await expect(generate).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Who is the character?" }).fill("Mira, an original fantasy cartographer.");
    await generate.click();
    await expect(preview).toContainText("<START>");
    await expect(preview).toContainText("{{user}}:");
    await expect(preview).toContainText("{{char}}:");
    await dialog.getByRole("button", { name: "Use draft for Example dialogue" }).click();

    await page.getByRole("tab", { name: "Greetings" }).click();
    await page.getByRole("button", { name: "Add greeting" }).click();
    await page.getByRole("button", { name: "AI for Greeting 2" }).click();
    await dialog.getByRole("textbox", { name: "Who is the character?" }).fill("Mira, an original fantasy cartographer.");
    await generate.click();
    await expect(preview).toContainText("{{char}}");
    await dialog.getByRole("button", { name: "Use draft for Greeting 2" }).click();

    const saved = page.waitForResponse((response) => response.url().endsWith("/api/rpc/characters.create"));
    await page.getByRole("button", { name: "Create character" }).click();
    const response = await saved;
    expect(response.ok()).toBeTruthy();
    const { data } = await response.json();
    characterId = data.id;
    expect(data.description).toBe("{{char}} maps lost trails.");
    expect(data.tags).toEqual(["fantasy", "travel", "mystery"]);
    expect(data.exampleDialogue).toMatch(/^<START>\n\{\{user\}\}:/);
    expect(data.alternateGreetings).toEqual([expect.stringContaining("{{char}}")]);
  } finally {
    if (characterId) await page.request.post("/api/rpc/characters.delete", { data: { id: characterId } });
  }
});
