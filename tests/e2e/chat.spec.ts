import { expect, test, type Page } from "@playwright/test";

async function rpc<T = unknown>(page: Page, name: string, body: unknown): Promise<T> {
  const res = await page.request.post(`/api/rpc/${name}`, { data: body });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data as T;
}

async function lastAssistantDone(page: Page) {
  // While streaming, a "Stop" button is shown in the header; wait for it to go away.
  await expect(page.getByRole("button", { name: "Stop" }).first()).toBeHidden({ timeout: 45_000 });
}

test("roleplay chat: send, stream, swipe, edit, persona switch, delete + undo", async ({ page }) => {
  const characters = await rpc<{ id: string; name: string }[]>(page, "characters.list", {});
  const character = characters[0];
  // Make sure this chat uses a fast mock model.
  const presets = await rpc<{ id: string }[]>(page, "presets.list", {});
  const preset = await rpc<{ id: string }>(page, "presets.create", { name: `e2e-${Date.now()}`, modelId: "mock/tavern-flash", params: { maxTokens: 300 } });
  const chat = await rpc<{ id: string }>(page, "chats.create", { characterId: character.id });
  await rpc(page, "chats.update", { id: chat.id, presetId: preset.id });

  await page.goto(`/chats/${chat.id}`);
  const composer = page.getByRole("textbox", { name: "Message" });
  await expect(composer).toBeVisible();

  // Send and stream a reply.
  await composer.fill("Hello! What's the story with the old mill?");
  await composer.press("Enter");
  await expect(page.getByText("Hello! What's the story with the old mill?")).toBeVisible();
  await lastAssistantDone(page);
  const replies = page.locator("[data-message-id]");
  await expect(replies).toHaveCount(3); // greeting + user + reply

  // Swipe: generate another version, then go back.
  await page.getByRole("button", { name: "Generate another" }).last().click();
  await lastAssistantDone(page);
  await expect(page.getByText("2/2").last()).toBeVisible();
  await page.getByRole("button", { name: "Previous version" }).last().click();
  await expect(page.getByText("1/2").last()).toBeVisible();

  // Edit the user message in place.
  const userMsg = replies.nth(1);
  await userMsg.hover();
  await userMsg.getByRole("button", { name: "Edit" }).click();
  const editor = userMsg.locator("textarea");
  await editor.fill("Hello! Tell me about the lantern instead.");
  await userMsg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Hello! Tell me about the lantern instead.")).toBeVisible();

  // Switch persona mid-chat and send as the other persona.
  const personas = await rpc<{ id: string; name: string }[]>(page, "personas.list", {});
  test.skip(personas.length < 2, "needs two personas");
  await page.getByRole("button", { name: "Switch persona" }).click();
  await page.getByRole("button", { name: new RegExp(personas[1].name) }).first().click();
  await composer.fill("A second voice joins the conversation.");
  await composer.press("Enter");
  await expect(page.locator("[data-message-id]").filter({ hasText: "A second voice joins" }).getByText(personas[1].name)).toBeVisible();
  await lastAssistantDone(page);

  // Delete the last reply and undo.
  const before = await page.locator("[data-message-id]").count();
  const last = page.locator("[data-message-id]").last();
  await last.hover();
  await last.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(before - 1);
  await page.locator("[data-sonner-toast]").filter({ hasText: "Message deleted" }).getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(before);

  // Cleanup.
  await rpc(page, "chats.delete", { id: chat.id });
  await rpc(page, "presets.delete", { id: preset.id });
  expect(presets.length).toBeGreaterThan(0);
});

test("command palette finds pages and characters", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder(/Search chats, characters/);
  await expect(input).toBeVisible();
  await input.fill("lorebooks");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/lorebooks/);
});

test("sidebar directories can be reordered by pointer and keyboard", async ({ page }) => {
  const prefix = `e2e-directory-${Date.now()}`;
  const firstName = `${prefix}-first`;
  const secondName = `${prefix}-second`;
  const chatTitle = `${prefix}-chat`;
  const created: string[] = [];
  let chatId: string | undefined;

  try {
    for (const name of [firstName, secondName]) {
      const directory = await rpc<{ id: string }>(page, "directories.create", { name });
      created.push(directory.id);
    }
    const [character] = await rpc<{ id: string }[]>(page, "characters.list", {});
    const chat = await rpc<{ id: string }>(page, "chats.create", { characterId: character.id });
    chatId = chat.id;
    await rpc(page, "chats.update", { id: chatId, directoryId: created[0], title: chatTitle });

    await page.goto("/");
    const section = page.getByRole("region", { name: "Directories" });
    const rows = section.getByRole("button", { name: new RegExp(`^${prefix}.* [01]$`) });
    const first = section.getByRole("button", { name: `${firstName} 1`, exact: true });
    const second = section.getByRole("button", { name: `${secondName} 0`, exact: true });
    const expectOrder = async (...names: string[]) => {
      await expect(rows).toHaveCount(names.length);
      for (const [index, name] of names.entries()) {
        await expect(rows.nth(index)).toHaveAccessibleName(`${name} ${name === firstName ? 1 : 0}`);
      }
    };

    await expectOrder(firstName, secondName);
    await first.press("Space");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await first.click();
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "false");
    await second.scrollIntoViewIfNeeded();
    const from = (await first.getByText(firstName, { exact: true }).boundingBox())!;
    const to = (await second.getByText(secondName, { exact: true }).boundingBox())!;
    const pointerSave = page.waitForResponse((response) => response.url().endsWith("/api/rpc/directories.reorder"));
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    const preview = page.locator("[data-dnd-dragging]");
    await expect(preview.getByText(firstName, { exact: true })).toBeVisible();
    await expect(preview.getByText(chatTitle, { exact: true })).toBeVisible();
    await expectOrder(secondName, firstName);
    await page.mouse.up();
    expect((await pointerSave).ok()).toBeTruthy();

    await page.reload();
    await expectOrder(secondName, firstName);
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await first.focus();
    await page.keyboard.press("Shift+Space");
    await page.keyboard.press("ArrowUp");
    await expectOrder(firstName, secondName);
    const keyboardSave = page.waitForResponse((response) => response.url().endsWith("/api/rpc/directories.reorder"));
    await page.keyboard.press("Space");
    expect((await keyboardSave).ok()).toBeTruthy();

    await page.reload();
    await expectOrder(firstName, secondName);
  } finally {
    if (chatId) await rpc(page, "chats.delete", { id: chatId });
    for (const id of created) await rpc(page, "directories.delete", { id });
  }
});
