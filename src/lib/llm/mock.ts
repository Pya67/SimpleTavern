/**
 * In-process mock of the OpenRouter HTTP API (models, key, chat/completions with SSE streaming).
 * Plugged into the real `@openrouter/ai-sdk-provider` via its `fetch` option, so the whole real
 * code path runs without network access or cost.
 *
 * Test hooks inside a user message:
 *   /mock-error 429|402|500|context   -> returns that error
 *   /mock-long                       -> produces a very long reply (good for scroll tests)
 */

type Json = Record<string, unknown>;

const ALL_PARAMS = [
  "temperature", "top_p", "top_k", "min_p", "top_a", "frequency_penalty", "presence_penalty",
  "repetition_penalty", "max_tokens", "seed", "stop",
];

export const MOCK_MODELS = [
  {
    id: "mock/tavern-storyteller",
    name: "Mock · Storyteller",
    description: "Offline mock model. Writes flavorful roleplay replies at a natural pace (~45 tok/s, bursty network).",
    context_length: 32768,
    pricing: { prompt: "0.0000005", completion: "0.0000015" },
    supported_parameters: ALL_PARAMS,
    speed: 45,
  },
  {
    id: "mock/tavern-thinker",
    name: "Mock · Thinker (reasoning)",
    description: "Offline mock reasoning model. Streams visible thinking before answering.",
    context_length: 65536,
    pricing: { prompt: "0.000002", completion: "0.000008" },
    supported_parameters: [...ALL_PARAMS, "reasoning", "include_reasoning"],
    speed: 70,
    reasoning: true,
  },
  {
    id: "mock/tavern-flash",
    name: "Mock · Flash",
    description: "Very fast offline mock (~220 tok/s). 8k context — handy for testing compaction.",
    context_length: 8192,
    pricing: { prompt: "0.0000001", completion: "0.0000004" },
    supported_parameters: ALL_PARAMS,
    speed: 220,
  },
  {
    id: "mock/tavern-tiny",
    name: "Mock · Tiny context (2k)",
    description: "Slow-ish mock with a 2048 token context window. Forces auto-compaction quickly.",
    context_length: 2048,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ALL_PARAMS,
    speed: 25,
  },
  {
    id: "mock/tavern-basic",
    name: "Mock · Basic (limited params)",
    description: "Mock that only supports temperature, top_p and max_tokens — other sliders are greyed out.",
    context_length: 16384,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    supported_parameters: ["temperature", "top_p", "max_tokens", "stop"],
    speed: 35,
  },
];

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, arr: T[]) => arr[Math.floor(r() * arr.length)];

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === "object" && "text" in p ? String((p as Json).text) : "")).join("");
  return "";
}

const STOP = new Set("the a an and or but if then so to of in on at for with from by is are was were be been it its this that you your i me my we our they them he she his her their what which who how why when where do does did not no yes just very really can could would should will about into over under than too also".split(" "));

function topicWord(text: string, r: () => number) {
  const words = (text.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter((w) => !STOP.has(w));
  if (!words.length) return null;
  words.sort((a, b) => b.length - a.length);
  return pick(r, words.slice(0, 3));
}

function rpReply(char: string, user: string, lastUser: string, r: () => number, long: boolean) {
  const topic = topicWord(lastUser, r);
  const actions = [
    `*${char} tilts their head, a slow smile tugging at the corner of their mouth.*`,
    `*${char} leans against the bar, fingers drumming a thoughtful rhythm on the worn wood.*`,
    `*A log shifts in the hearth, scattering sparks. ${char} watches them die before answering.*`,
    `*${char}'s eyes narrow — not unkindly, but with the look of someone weighing a coin for fakes.*`,
    `*${char} laughs, low and genuine, and the tension in the room loosens a notch.*`,
    `*Outside, the storm howls against the shutters. ${char} doesn't seem to notice.*`,
    `*${char} reaches beneath the counter and produces a dusty bottle, uncorking it with practiced ease.*`,
  ];
  const lines = [
    `"You know, ${user}, most people don't ask me that twice."`,
    `"I'll tell you what I know — but it'll cost you a story of your own."`,
    `"Careful. Questions like that have a way of growing teeth."`,
    `"Hah! Now *that* is the most interesting thing anyone's said to me all week."`,
    `"Sit a while. The night's long, and I've got nowhere better to be."`,
    `"Fine, fine. But if anyone asks, you didn't hear it from me."`,
  ];
  const topicLines = topic
    ? [
        `"${topic[0].toUpperCase() + topic.slice(1)}? Gods, you really do pick the strangest things to wonder about."`,
        `"Ah, ${topic}. There's a story there — the kind folk only tell after their third drink."`,
        `"If it's ${topic} you're after, you'd best keep your voice down. Walls here have ears, and some of them gossip."`,
      ]
    : [];
  const paras: string[] = [];
  const n = long ? 14 : 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const act = pick(r, actions);
    const line = i === 0 && topicLines.length ? pick(r, topicLines) : pick(r, lines);
    paras.push(i % 2 === 0 ? `${act}\n\n${line}` : `${line} ${act}`);
  }
  if (r() > 0.6) paras.push(`*${char} slides a steaming mug toward ${user}.* "On the house. Don't get used to it."`);
  return paras.join("\n\n");
}

function summarize(text: string, r: () => number) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?"])\s+/)
    .filter((s) => s.length > 30)
    .slice(0, 400);
  const chosen: string[] = [];
  for (let i = 0; i < sentences.length && chosen.length < 7; i += Math.max(1, Math.floor(sentences.length / 7))) {
    chosen.push(sentences[i].replace(/[*"]/g, "").trim());
  }
  const lead = pick(r, ["Earlier,", "Previously,", "In the story so far,"]);
  const body = `${lead} ${chosen.join(" ")}`.slice(0, 1400) || "Not much happened yet.";
  const names = [...new Set(text.match(/\b[A-Z][a-z]{3,}\b/g) ?? [])].filter((n) => !["Earlier", "Previously", "Careful", "Outside", "Sit", "Well", "Fine", "Something"].includes(n));
  const fact = names.length && r() > 0.4 ? `\nFACT: ${names[0]} trusts the traveler a little more than they let on.` : "";
  return body + fact;
}

/** Emotion appraisal: reacts to a few keywords in the exchange so the engine visibly moves. */
function mockAppraisal(text: string, r: () => number) {
  const t = text.toLowerCase();
  const imp: Record<string, number> = { joy: 0, trust: 0, fear: 0, surprise: 0, sadness: 0, disgust: 0, anger: 0, anticipation: Math.round(r() * 10) };
  let affection = Math.round(r() * 4 - 1);
  let label = pick(r, ["amused", "curious", "guarded", "wry"]);
  // Faces are list numbers (see the "Faces:" list in the appraisal prompt).
  let kaomoji = pick(r, [16, 13, 1]);
  const set = (i: Record<string, number>, l: string, face: number, aff?: number) => {
    Object.assign(imp, i);
    label = l;
    kaomoji = face;
    if (aff !== undefined) affection = aff;
  };
  if (/thank|love|kind|beautiful|friend|smile|hug/.test(t)) set({ joy: 22, trust: 14 }, "touched", 9, 6);
  if (/sorry|sad|cry|lost|miss|died|alone/.test(t)) set({ sadness: 24, joy: -10 }, "melancholy", 20);
  if (/hate|stupid|kill|fight|liar|shut up|idiot/.test(t)) set({ anger: 30, trust: -15 }, "bristling", 26, -8);
  if (/scared|danger|monster|run|blood|dark/.test(t)) set({ fear: 26, anticipation: 10 }, "on edge", 30);
  if (/secret|surprise|what\?|really\?|wow/.test(t)) set({ surprise: 25 }, "intrigued", 28);
  if (r() > 0.5) imp.trust += 4;
  return JSON.stringify({ impulse: imp, affection, label, kaomoji, note: `Weighing what was just said — ${label}, though not showing all of it.` });
}

function mockBaseline(r: () => number) {
  const n = (base: number) => Math.round(base + r() * 15);
  // Fenced, like many real models reply, to exercise the parser.
  return "```json\n" + JSON.stringify({ joy: n(20), trust: n(15), fear: n(3), surprise: n(5), sadness: n(5), disgust: n(2), anger: n(3), anticipation: n(20) }) + "\n```";
}

function reasoningFor(char: string, lastUser: string) {
  return `The user said: "${lastUser.slice(0, 120)}". I should stay in character as ${char}, react to what they said, keep the tone warm but guarded, and move the scene forward without speaking for them. Maybe hint at a secret to keep things intriguing.`;
}

function characterFieldDraft(message: string): string | null {
  let input: { field?: string; mode?: string; text?: string; character?: { name?: string } };
  try {
    input = JSON.parse(message);
  } catch {
    return null;
  }
  if (typeof input?.text !== "string" || typeof input.field !== "string") return null;
  if (input.mode === "improve") return input.text.trim().replace(/[^\S\r\n]+/g, " ");

  const name = input.character?.name || input.text.split(/[,\n]/)[0].slice(0, 100).trim();
  const greeting = '*{{char}} peers over a weathered map.* "I could use someone who knows these roads. What brings you out here?"';
  const drafts: Record<string, string> = {
    name,
    tagline: "A guarded traveler with a map full of unfinished journeys.",
    tags: "fantasy, travel, mystery",
    description: "{{char}} is a traveler known for finding routes that have fallen off the map. They keep careful notes and rarely offer help without asking a question in return.",
    personality: "Observant and guarded, {{char}} uses dry humor to buy time. They warm to people who keep their word.",
    scenario: "{{user}} meets {{char}} at a crossroads where the marked trail abruptly ends. An approaching storm makes it urgent to find another way through.",
    firstMessage: greeting,
    alternateGreeting: '*{{char}} holds the door open as rain rattles the roof.* "Come in. Have you seen anyone else on the road tonight?"',
    exampleDialogue: '<START>\n{{user}}: Have you been here before?\n{{char}}: *taps the weathered map* "Once. The road remembered me better than I remembered it."',
    systemPrompt: "Portray {{char}} with dry humor and a measured voice. Maintain scene continuity and leave {{user}} in control of their choices.",
    postHistoryInstructions: "Keep {{char}}'s reply grounded in the scene and leave room for {{user}} to respond.",
    creatorNotes: "Start at the crossroads and decide whether to trust the traveler and their map.",
    creator: "Crossroads Scribe",
    characterVersion: "1.0",
  };
  return Object.hasOwn(drafts, input.field) ? drafts[input.field] : null;
}

function tokenize(text: string, r: () => number) {
  // Bursty chunking: 1-6 "tokens" per network chunk.
  const toks = text.match(/\s*\S+|\s+/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < toks.length; ) {
    const n = 1 + Math.floor(r() * (r() > 0.85 ? 6 : 2));
    chunks.push(toks.slice(i, i + n).join(""));
    i += n;
  }
  return chunks;
}

function approxTokens(s: string) {
  return Math.ceil(s.length / 3.7);
}

async function chatCompletions(body: Json, signal?: AbortSignal | null): Promise<Response> {
  const model = MOCK_MODELS.find((m) => m.id === body.model) ?? MOCK_MODELS[0];
  const messages = (body.messages as { role: string; content: unknown }[]) ?? [];
  const all = messages.map((m) => textOf(m.content)).join("\n");
  const sys = messages.filter((m) => m.role === "system").map((m) => textOf(m.content)).join("\n");
  const lastUser = textOf([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
  const last = messages[messages.length - 1];

  const err = lastUser.match(/\/mock-error\s+(\w+)/);
  if (err) {
    const code = err[1];
    if (code === "429") return json({ error: { code: 429, message: "Rate limit exceeded (mock). Try again in a few seconds." } }, 429);
    if (code === "402") return json({ error: { code: 402, message: "Insufficient credits (mock). Add credits to continue." } }, 402);
    if (code === "context") return json({ error: { code: 400, message: "This model's maximum context length is exceeded (mock)." } }, 400);
    return json({ error: { code: 500, message: "Upstream provider error (mock)." } }, 500);
  }

  const promptTokens = approxTokens(all);
  if (promptTokens > model.context_length) {
    return json({ error: { code: 400, message: `This endpoint's maximum context length is ${model.context_length} tokens. You requested about ${promptTokens}.` } }, 400);
  }

  const char = sys.match(/You are ([^\s,.]+(?: [A-Z][a-z]+)?)/)?.[1] ?? "The narrator";
  const user = all.match(/About ([^:\n]+):/)?.[1]?.trim() ?? "traveler";
  const seed = typeof body.seed === "number" ? body.seed : hash(all + Date.now());
  const r = rng(seed);

  let content: string;
  let reasoning: string | null = null;
  const fieldDraft = sys.startsWith("You are editing one field of a roleplay character card.") ? characterFieldDraft(lastUser) : null;
  if (fieldDraft !== null) {
    content = fieldDraft;
  } else if (/emotion engine for a roleplay character/i.test(sys)) {
    content = /resting temperament/i.test(sys) ? mockBaseline(r) : mockAppraisal(lastUser, r);
  } else if (/memory keeper|Merge these consecutive story recaps/i.test(all)) {
    content = summarize(textOf(last?.content ?? ""), r);
  } else if (/short title/i.test(all)) {
    const t = topicWord(lastUser, r) ?? "Evening";
    content = pick(r, [`Secrets of the ${t}`, `A Night of ${t[0].toUpperCase() + t.slice(1)}`, `The ${t[0].toUpperCase() + t.slice(1)} Affair`, "Storm at the Tankard"]);
  } else if (/next message, in .*voice/i.test(all)) {
    content = pick(r, [
      `*I shake the rain from my cloak and take the offered towel.* "Something warm, please. And maybe a little honesty, if you're serving it."`,
      `*I lean in, lowering my voice.* "I'm looking for someone. Tall, grey coat, never smiles. Ring any bells?"`,
      `"Brave, lost — why not both?" *I grin and pull out a stool.*`,
    ]);
  } else if (last?.role === "assistant") {
    content = " " + pick(r, [
      `*${char} pauses, as if deciding how much more to say.* "There's more, of course. There always is."`,
      `"...but that's a story for after the storm passes." *${char} winks.*`,
      `*${char}'s voice drops to a whisper.* "And that's when the lights went out."`,
    ]);
  } else {
    content = rpReply(char, user, lastUser, r, /\/mock-long/.test(lastUser));
  }

  const reasoningOpt = body.reasoning as { enabled?: boolean; exclude?: boolean; effort?: string } | undefined;
  const wantsReasoning = ((model as { reasoning?: boolean }).reasoning || reasoningOpt?.enabled) && reasoningOpt?.effort !== "none";
  if (wantsReasoning && !reasoningOpt?.exclude && !/memory keeper|short title|emotion engine/i.test(all)) {
    reasoning = reasoningFor(char, lastUser);
  }

  // Like real providers, thinking is billed against max_tokens. Simulate a realistic thinking
  // spend by effort so a too-small limit reproduces an empty, length-truncated reply.
  const THINK: Record<string, number> = { minimal: 150, low: 300, medium: 600, high: 1200, xhigh: 2000 };
  const thinkingTokens = reasoning ? ((reasoningOpt as { max_tokens?: number } | undefined)?.max_tokens ?? THINK[reasoningOpt?.effort ?? "medium"] ?? 600) : 0;
  const maxTokens = Math.max(0, (typeof body.max_tokens === "number" ? body.max_tokens : 2000) - thinkingTokens);
  let finish = "stop";
  const contentTokens = tokenize(content, r);
  let chunks = contentTokens;
  if (contentTokens.length > maxTokens) {
    chunks = contentTokens.slice(0, maxTokens);
    finish = "length";
  }
  const completionText = chunks.join("");
  const completionTokens = approxTokens(completionText) + thinkingTokens;
  const cost =
    promptTokens * parseFloat(model.pricing.prompt) + completionTokens * parseFloat(model.pricing.completion);
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    cost: Math.round(cost * 1e9) / 1e9,
    completion_tokens_details: { reasoning_tokens: thinkingTokens },
  };
  const id = `gen-mock-${hash(String(seed))}`;
  const created = Math.floor(Date.now() / 1000);

  if (!body.stream) {
    await sleep(300 + completionText.length * 2, signal);
    return json({
      id,
      model: model.id,
      provider: "Mock",
      created,
      object: "chat.completion",
      choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: completionText, reasoning } }],
      usage,
    });
  }

  const speed = model.speed;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const base = { id, model: model.id, provider: "Mock", created, object: "chat.completion.chunk" };
      try {
        // Time to first token.
        await sleep(250 + r() * 450, signal);
        if (reasoning) {
          for (const c of tokenize(reasoning, r)) {
            send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "", reasoning: c }, finish_reason: null }] });
            await sleep(((c.split(/\s+/).length || 1) * 1000) / (speed * 1.6) + r() * 25, signal);
          }
          await sleep(150, signal);
        }
        for (const c of chunks) {
          send({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: c }, finish_reason: null }] });
          // Bursty: occasional network hiccups.
          const hiccup = r() > 0.94 ? 120 + r() * 220 : 0;
          await sleep(((c.split(/\s+/).length || 1) * 1000) / speed + r() * 30 + hiccup, signal);
        }
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
        send({ ...base, choices: [], usage });
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

export const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url).pathname.replace(/^.*\/v1/, "");
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

  if (path.startsWith("/models") && method === "GET") {
    return json({
      data: MOCK_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        context_length: m.context_length,
        pricing: m.pricing,
        supported_parameters: m.supported_parameters,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        top_provider: { context_length: m.context_length, max_completion_tokens: 4096 },
      })),
    });
  }
  if (path.startsWith("/key") && method === "GET") {
    return json({ data: { label: "mock-key", usage: 0.42, limit: 10, limit_remaining: 9.58, is_free_tier: false } });
  }
  if (path.startsWith("/chat/completions") && method === "POST") {
    let raw: string;
    if (typeof init?.body === "string") raw = init.body;
    else if (init?.body instanceof Uint8Array) raw = new TextDecoder().decode(init.body);
    else if (input instanceof Request) raw = await input.text();
    else raw = String(init?.body ?? "{}");
    return chatCompletions(JSON.parse(raw), init?.signal);
  }
  return json({ error: { code: 404, message: `Mock: no route for ${method} ${path}` } }, 404);
};
