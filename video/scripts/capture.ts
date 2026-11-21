/**
 * Records the promo clips from your running SimpleTavern, using your real characters and models.
 *
 *   1. In the app folder, start the dev server without the login screen (real OpenRouter stays on):
 *        $env:AUTH_BYPASS="true"; $env:OPENROUTER_MOCK="false"; pnpm dev
 *   2. In video/:  npm run capture                 (every clip)
 *                  npm run capture -- chat theme    (only some)
 *
 * Clips land in public/clips/<name>.mp4 and their timing (cuts, keycaps) in src/clips.json.
 *
 * What it touches: it creates a throwaway chat (real generations, so a few cents at most), two
 * temporary directories for the drag-and-drop shot, switches the chat's preset to GLM 4.7 Flash on
 * camera, and flips your accent colour while filming the theme picker. All of that is deleted or
 * restored at the end, even if a shot fails.
 *
 * Env: APP_URL (default http://localhost:3000), PROMO_CHARACTER (default "Asa Mitaka", else your first character).
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Recorder, type ClipInfo } from "./recorder";

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";
const CHARACTER = process.env.PROMO_CHARACTER ?? "Asa Mitaka";
const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "src", "clips.json");

// Recorded at exactly the size they're shown in the video, so nothing gets resampled.
export const DESKTOP = { width: 1600, height: 900 };
export const PHONE = { width: 430, height: 932 };

// Typed into the chat. Kaomoji welcome ♡
const LINES = {
  desktop: "hiii (｡•ᴗ•｡)♡ wanna be study buddies? i brought snacks",
  boldLine: "okay fine, you're adorable",
  italicLine: "hides behind my textbook",
  lore: "tell me everything about ",
};

const PANEL_TABS = ["Character", "Persona", "LLM", "Memory", "Emotion", "Lore", "Context"];
const MODEL_SEARCH = "glm";
const MODEL_OPTION = /GLM[\s-]*4\.7[\s-]*Flash/i;

// ---------------------------------------------------------------------------------------------
// API helpers (AUTH_BYPASS means no cookie is needed)

async function rpc<T = unknown>(name: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("The app wants a login. Restart it with AUTH_BYPASS=true (see the top of this file).");
  if (!res.ok) throw new Error(`rpc ${name} failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: T }).data;
}

const cleanups: (() => Promise<unknown>)[] = [];

let chatId: string | undefined;
async function promoChat() {
  if (chatId) return chatId;
  const characters = await rpc<{ id: string; name: string }[]>("characters.list");
  const character = characters.find((c) => c.name === CHARACTER) ?? characters[0];
  if (!character) throw new Error("You need at least one character.");
  const chat = await rpc<{ id: string }>("chats.create", { characterId: character.id });
  chatId = chat.id;
  await rpc("chats.update", { id: chat.id, title: "study date ♡" });
  cleanups.push(() => rpc("chats.delete", { id: chat.id }));
  return chatId;
}

/** Picking a model in the composer edits the preset itself, so remember every preset's model. */
let presetModels: Map<string, string> | undefined;
async function rememberPresetModels() {
  if (presetModels) return;
  const presets = await rpc<{ id: string; modelId: string }[]>("presets.list");
  presetModels = new Map(presets.map((p) => [p.id, p.modelId]));
  cleanups.push(restorePresetModels);
}
async function restorePresetModels() {
  if (!presetModels) return;
  const now = await rpc<{ id: string; modelId: string }[]>("presets.list");
  for (const p of now) {
    const before = presetModels.get(p.id);
    if (before && before !== p.modelId) await rpc("presets.update", { id: p.id, modelId: before });
  }
}

// ---------------------------------------------------------------------------------------------
// Page helpers

const messages = (page: Page) => page.locator("[data-message-id]");
const lastText = (page: Page) => messages(page).last().innerText().catch(() => "");
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

/** Resolves once the reply has visibly started (a few words in). */
async function firstWords(page: Page, before: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const t = await lastText(page);
    if (t !== before && t.length > before.length * 0.2 + 40) return;
    await page.waitForTimeout(40);
  }
}

/** Resolves once the last message has stopped changing, i.e. the whole reply is in. */
async function settled(page: Page, quietMs = 1400) {
  let prev = await lastText(page);
  let quietSince = Date.now();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const t = await lastText(page);
    if (t !== prev) {
      prev = t;
      quietSince = Date.now();
    } else if (Date.now() - quietSince > quietMs) return;
  }
}

async function typeAndSend(page: Page, rec: Recorder | null, text: string) {
  await clickSmooth(page, composer(page));
  await composer(page).pressSequentially(text, { delay: 34 });
  await page.waitForTimeout(300);
  const count = await messages(page).count();
  if (rec) await rec.press("Enter", "Enter");
  else await composer(page).press("Enter");
  await messages(page).nth(count + 1).waitFor({ timeout: 30_000 });
  if (rec) await rec.cut(() => firstWords(page, ""));
  else await firstWords(page, "");
  await settled(page);
}

/** Makes sure the promo chat has at least one real reply (for shots that start mid-chat). */
async function ensureReply(page: Page) {
  if ((await messages(page).count()) < 3) await typeAndSend(page, null, LINES.desktop);
}

async function openChat(page: Page) {
  await page.goto(`${BASE_URL}/chats/${await promoChat()}`);
  await composer(page).waitFor();
  await page.waitForTimeout(500);
}

/** Eased mouse glide (~0.45s), so the drawn cursor moves like a hand would. */
const mouse = { x: 800, y: 450 };
async function glide(page: Page, x: number, y: number, ms = 450) {
  const from = { ...mouse };
  const steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(8);
  }
  mouse.x = x;
  mouse.y = y;
}

async function hoverCenter(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (box) await glide(page, box.x + box.width / 2, box.y + box.height / 2);
}

/** Glide to the element and click it with the raw mouse (locator.click's checks crawl while recording). */
async function clickSmooth(page: Page, locator: Locator, pause = 200) {
  await locator.waitFor();
  await locator.scrollIntoViewIfNeeded();
  await hoverCenter(page, locator);
  await page.waitForTimeout(pause);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

/**
 * A real touch swipe (CDP touch events, so the app sees pointerType "touch").
 * Negative dx swipes left. The finger dot is drawn by the phone context's init script.
 */
async function touchSwipe(page: Page, target: Locator, dx: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const vh = page.viewportSize()!.height;
  const top = Math.max(box.y, 90);
  const bottom = Math.min(box.y + box.height, vh - 160);
  const x = box.x + box.width * 0.72;
  const y = Math.round((top + bottom) / 2);
  const cdp = await page.context().newCDPSession(page);
  const point = (px: number) => [{ x: Math.round(px), y, id: 1, radiusX: 14, radiusY: 14, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(x) });
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = 1 - Math.pow(1 - t, 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x + dx * eased) });
    await page.waitForTimeout(14);
  }
  await page.waitForTimeout(60);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

// ---------------------------------------------------------------------------------------------
// Shots

type Shot = { device: "desktop" | "phone"; prepare?: (page: Page) => Promise<void>; film: (page: Page, rec: Recorder) => Promise<void> };

const shots: Record<string, Shot> = {
  /**
   * The hero shot: one whole streamed reply, Ctrl+B / Ctrl+I formatting on a new message,
   * switching to GLM 4.7 Flash, then a tour of every side-panel tab.
   */
  chat: {
    device: "desktop",
    async prepare(page) {
      await rememberPresetModels();
      await openChat(page);
    },
    async film(page, rec) {
      await glide(page, 950, 860);
      await typeAndSend(page, rec, LINES.desktop);
      await page.waitForTimeout(1200);

      // Formatting: select a word and bold it, then a new line in italics.
      const box = composer(page);
      await clickSmooth(page, box);
      await box.pressSequentially(LINES.boldLine, { delay: 34 });
      await page.waitForTimeout(250);
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await page.waitForTimeout(350);
      await rec.press("Control+b", "Ctrl + B");
      await page.waitForTimeout(800);
      await page.keyboard.press("End");
      await rec.press("Shift+Enter", "Shift + Enter");
      await box.pressSequentially(LINES.italicLine, { delay: 34 });
      await page.waitForTimeout(250);
      await page.keyboard.press("Shift+Home");
      await page.waitForTimeout(350);
      await rec.press("Control+i", "Ctrl + I");
      await page.waitForTimeout(1200);

      // Model picker: filter by "glm" and pick GLM 4.7 Flash.
      await clickSmooth(page, page.getByRole("button", { name: "Choose model" }));
      const search = page.getByPlaceholder("Search models…");
      await search.waitFor();
      await page.waitForTimeout(300);
      await search.pressSequentially(MODEL_SEARCH, { delay: 110 });
      await page.waitForTimeout(700);
      await clickSmooth(page, page.getByRole("option", { name: MODEL_OPTION }).first(), 400);
      await page.waitForTimeout(1000);

      // Side panel via the settings icon, then every tab.
      await clickSmooth(page, page.getByRole("button", { name: "Toggle panel" }));
      await page.waitForTimeout(900);
      for (const tab of PANEL_TABS) {
        await clickSmooth(page, page.getByRole("button", { name: tab, exact: true }), 120);
        await page.waitForTimeout(1100);
      }
      await page.waitForTimeout(400);
    },
  },

  /** Hover actions, swipe to a new version (→), then ↑ opens the edit box and lingers. */
  actions: {
    device: "desktop",
    async prepare(page) {
      await openChat(page);
      await ensureReply(page);
    },
    async film(page, rec) {
      await hoverCenter(page, messages(page).last());
      await page.waitForTimeout(900);
      await composer(page).focus();
      const old = await lastText(page);
      await rec.press("ArrowRight", "→");
      await rec.cut(() => firstWords(page, old));
      await settled(page, 1000);
      await page.waitForTimeout(500);
      await rec.press("ArrowUp", "↑");
      await page.waitForTimeout(2200);
      await rec.press("Escape", "Esc");
      await page.waitForTimeout(500);
    },
  },

  /** Switching persona mid-chat (Alt+P). Nothing is changed. */
  persona: {
    device: "desktop",
    prepare: openChat,
    async film(page, rec) {
      await page.waitForTimeout(400);
      await composer(page).focus();
      await rec.press("Alt+p", "Alt + P");
      await page.waitForTimeout(1800);
      await rec.press("Escape", "Esc");
      await page.waitForTimeout(400);
    },
  },

  /** Phone: swipe a reply left to retry it (streams a new version), then swipe your message left to edit. */
  mobile: {
    device: "phone",
    async prepare(page) {
      await openChat(page);
      await ensureReply(page);
      await messages(page).last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
    },
    async film(page, rec) {
      await page.waitForTimeout(500);
      const old = await lastText(page);
      await touchSwipe(page, messages(page).last(), -230);
      await rec.cut(() => firstWords(page, old));
      await settled(page, 1000);
      await page.waitForTimeout(700);

      const count = await messages(page).count();
      const mine = messages(page).nth(count - 2);
      await mine.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await touchSwipe(page, mine, -200);
      await page.waitForTimeout(2000);
    },
  },

  /** Settings → Appearance: several accents, then Light, Black and Dark, ending on Blue + Dark. */
  theme: {
    device: "desktop",
    async prepare(page) {
      await page.goto(`${BASE_URL}/settings#appearance`);
      await page.locator("#appearance").waitFor();
      await page.locator("#appearance").scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
    },
    async film(page) {
      const card = page.locator("#appearance");
      const pick = async (name: string, pause = 420) => {
        await clickSmooth(page, card.getByRole("button", { name, exact: true }), 120);
        await page.waitForTimeout(pause);
      };
      for (const accent of ["Pink", "Violet", "Rose", "Teal", "Emerald"]) await pick(`${accent} accent`);
      await pick("Light", 900);
      await pick("Black", 900);
      await pick("Dark", 700);
      await pick("Blue accent", 1000);
    },
  },

  /** Characters grid and the JanitorAI import dialog (nothing is imported). */
  characters: {
    device: "desktop",
    async prepare(page) {
      await page.goto(`${BASE_URL}/characters`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
    },
    async film(page) {
      await glide(page, 700, 420);
      await page.waitForTimeout(500);
      await clickSmooth(page, page.getByRole("button", { name: "Import" }));
      await page.waitForTimeout(400);
      await clickSmooth(page, page.getByRole("menuitem", { name: /JanitorAI/ }));
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(1800);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    },
  },

  /** A lorebook, with the keyword tester lighting up an entry. */
  lorebooks: {
    device: "desktop",
    async prepare(page) {
      await page.goto(`${BASE_URL}/lorebooks`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
    },
    async film(page) {
      const books = await rpc<{ id: string; name: string; entryCount: number }[]>("lorebooks.list");
      const book = books.find((b) => b.entryCount > 0) ?? books[0];
      if (!book) return void (await page.waitForTimeout(2500));
      const full = await rpc<{ entries: { keys: string[] }[] }>("lorebooks.get", { id: book.id });
      const keyword = full.entries.find((e) => e.keys.length)?.keys[0] ?? book.name;

      await clickSmooth(page, page.getByRole("button", { name: new RegExp(book.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first());
      await page.waitForTimeout(500);
      await clickSmooth(page, page.getByRole("button", { name: /Test matcher/ }));
      const box = page.getByPlaceholder(/see which entries activate/);
      await box.waitFor();
      await box.pressSequentially(LINES.lore + keyword, { delay: 45 });
      await page.waitForTimeout(1300);
    },
  },

  /** Drag-and-drop in the sidebar, using two temporary directories. */
  sidebar: {
    device: "desktop",
    async prepare(page) {
      for (const name of ["✧ cozy arcs", "♡ comfort chats"]) {
        const dir = await rpc<{ id: string }>("directories.create", { name });
        cleanups.push(() => rpc("directories.delete", { id: dir.id }));
      }
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
    },
    async film(page) {
      const section = page.getByRole("region", { name: "Directories" });
      const first = section.getByRole("button", { name: "✧ cozy arcs 0", exact: true });
      const second = section.getByRole("button", { name: "♡ comfort chats 0", exact: true });
      await first.scrollIntoViewIfNeeded();
      const from = (await first.boundingBox())!;
      const to = (await second.boundingBox())!;
      await glide(page, from.x + from.width / 2, from.y + from.height / 2);
      await page.waitForTimeout(300);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 6 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 6, { steps: 45 });
      await page.waitForTimeout(500);
      await page.mouse.up();
      mouse.x = to.x + to.width / 2;
      mouse.y = to.y + to.height / 2 + 6;
      await page.waitForTimeout(1000);
    },
  },

  /** Prompt templates: every block of the prompt, in order. */
  templates: {
    device: "desktop",
    async prepare(page) {
      await page.goto(`${BASE_URL}/presets?tab=templates`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
    },
    async film(page) {
      await glide(page, 1000, 300);
      await page.waitForTimeout(500);
      // One smooth scroll through the blocks (wheel ticks each wait on the scroll and crawl).
      await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"], [role="tabpanel"]:not([hidden])');
        const scroller = panel && panel.scrollHeight > panel.clientHeight ? panel : document.scrollingElement;
        scroller?.scrollBy({ top: 520, behavior: "smooth" });
      });
      await page.waitForTimeout(1400);
      const handle = page.getByRole("button", { name: "Drag" }).nth(2);
      if (await handle.isVisible().catch(() => false)) await hoverCenter(page, handle);
      await page.waitForTimeout(900);
    },
  },
};

// ---------------------------------------------------------------------------------------------

async function newContext(browser: Browser, device: Shot["device"]): Promise<BrowserContext> {
  const context = await browser.newContext(
    device === "desktop"
      ? { viewport: DESKTOP, colorScheme: "dark" }
      : { viewport: PHONE, colorScheme: "dark", isMobile: true, hasTouch: true },
  );
  // Blue + Dark look, hidden API key and dev badge, and a drawn cursor / finger dot (see page-init.js).
  await context.addInitScript({ content: `window.__PROMO_PHONE = ${device === "phone"};` });
  await context.addInitScript({ path: path.join(import.meta.dirname, "page-init.js") });
  return context;
}

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const names = wanted.length ? wanted : Object.keys(shots);
  for (const n of names) if (!shots[n]) throw new Error(`Unknown clip "${n}". Options: ${Object.keys(shots).join(", ")}`);

  const reachable = await fetch(BASE_URL).catch(() => null);
  if (!reachable) throw new Error(`Can't reach ${BASE_URL}. Start the app first (see the top of this file).`);
  const settings = await rpc<{ mock: boolean; hasKey: boolean; ui: { accent?: string } }>("settings.get");
  if (settings.mock && !process.argv.includes("--allow-mock"))
    throw new Error("The app is running the OpenRouter mock. Restart it with OPENROUTER_MOCK=false to film real replies.");
  if (!settings.mock && !settings.hasKey) throw new Error("No OpenRouter key is set. Add one in Settings → Connection.");

  const originalAccent = settings.ui.accent ?? "amber";
  await rpc("settings.update", { ui: { accent: "blue" } });
  cleanups.push(() => rpc("settings.update", { ui: { accent: originalAccent } }));

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as Record<string, ClipInfo>;
  delete manifest.panel; // retired shot
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const name of names) {
      const shot = shots[name];
      process.stdout.write(`● ${name}… `);
      const context = await newContext(browser, shot.device);
      const page = await context.newPage();
      try {
        await shot.prepare?.(page);
        if (shot.device === "desktop") {
          await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2);
          Object.assign(mouse, { x: DESKTOP.width / 2, y: DESKTOP.height / 2 });
        }
        const rec = new Recorder(page, shot.device === "desktop" ? DESKTOP : PHONE);
        await rec.start();
        await shot.film(page, rec);
        manifest[name] = await rec.save(path.join(ROOT, "public", "clips", `${name}.mp4`));
        await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
        const shown = manifest[name].segments.reduce((s, [a, b]) => s + b - a, 0);
        console.log(`✓ ${shown.toFixed(1)}s`);
      } finally {
        await page.waitForTimeout(1500).catch(() => {}); // let the app's debounced autosaves land
        await context.close();
        // Put the real model back straight away, so later shots use your usual one.
        if (name === "chat") await restorePresetModels().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    for (const cleanup of cleanups.reverse()) await cleanup().catch((e) => console.warn("cleanup:", e.message));
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
