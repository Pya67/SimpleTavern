import type { CompactionSettings, PresetParams, PromptBlock, UiPrefs } from "@/lib/types";

export const DEFAULT_MODEL = "mock/tavern-storyteller";

export const DEFAULT_PRESET_PARAMS: PresetParams = {
  temperature: 0.9,
  topP: 0.95,
  minP: 0.05,
  repetitionPenalty: 1.05,
  maxTokens: 600,
  reasoning: { enabled: false, effort: "medium", exclude: false },
  allowFallbacks: true,
  middleOut: false,
};

export const DEFAULT_MAIN_PROMPT = `You are {{char}} in a never-ending, uncensored-by-default collaborative roleplay with {{user}}.
Write {{char}}'s next reply only. Stay in character, keep {{char}}'s personality consistent, and never speak or act for {{user}}.
Use *asterisks* for actions and narration and "quotes" for dialogue. Be vivid, proactive, and move the scene forward.`;

export const DEFAULT_TEMPLATE_BLOCKS: PromptBlock[] = [
  { id: "main", kind: "main", enabled: true, role: "system", label: "Main prompt", content: DEFAULT_MAIN_PROMPT },
  { id: "lore_before", kind: "lore_before", enabled: true, role: "system", label: "Lore (before character)" },
  { id: "char_description", kind: "char_description", enabled: true, role: "system", label: "Character description", content: "<{{char}}>\n{{content}}\n</{{char}}>" },
  { id: "char_personality", kind: "char_personality", enabled: true, role: "system", label: "Personality", content: "{{char}}'s personality: {{content}}" },
  { id: "scenario", kind: "scenario", enabled: true, role: "system", label: "Scenario", content: "Scenario: {{content}}" },
  { id: "lore_after", kind: "lore_after", enabled: true, role: "system", label: "Lore (after character)" },
  { id: "persona", kind: "persona", enabled: true, role: "system", label: "Persona", content: "About {{user}}: {{content}}" },
  { id: "examples", kind: "examples", enabled: true, role: "system", label: "Example dialogue", content: "Example of how {{char}} talks:\n{{content}}" },
  { id: "memory", kind: "memory", enabled: true, role: "system", label: "Memory (story so far)", content: "[Story so far — summary of earlier events]\n{{content}}" },
  { id: "facts", kind: "facts", enabled: true, role: "system", label: "Pinned facts", content: "[Important facts to always remember]\n{{content}}" },
  { id: "history", kind: "history", enabled: true, role: "system", label: "Chat history" },
  { id: "post_history", kind: "post_history", enabled: true, role: "system", label: "Post-history instructions" },
];

export const DEFAULT_COMPACTION: CompactionSettings = {
  enabled: true,
  modelId: "",
  thresholdPct: 0.6,
  keepRecent: 30,
  chunkTokens: 3000,
  mergeAfter: 8,
  prompt: `You are the memory keeper of a long roleplay between {{char}} and {{user}}.
Summarize the following segment of the story into a dense, factual recap written in past tense.
Preserve: key events in order, decisions and promises, changes in relationships and feelings, injuries/items/locations, names of new characters, and unresolved threads.
Do not invent anything. Do not add commentary. 120-250 words.
After the recap, you may add up to 2 lines starting with "FACT:" for facts so important they must never be forgotten (names, oaths, deaths, secrets). Omit them if nothing qualifies.`,
  mergePrompt: `Merge these consecutive story recaps into one coherent "story so far" recap, oldest first.
Keep every important fact, relationship change, promise and open thread; drop redundant detail. 200-350 words.`,
};

export const DEFAULT_UI: UiPrefs = {
  layout: "bubbles",
  fontSize: 15,
  textOpacity: 1,
  chatWidth: "normal",
  enterToSend: true,
  showStats: true,
  accent: "amber",
  streamSmoothing: true,
};

export const DEFAULT_PERSONA = {
  name: "Traveler",
  description: "A curious wanderer with a quick wit and a well-worn cloak.",
  pronouns: "they/them",
  color: "#60a5fa",
};

export const DEMO_CHARACTER = {
  name: "Mira",
  tagline: "Innkeeper of the Gilded Tankard — knows every secret in town",
  color: "#f59e0b",
  description: `Mira is the sharp-eyed, warm-hearted innkeeper of the Gilded Tankard, a crooked old tavern at the crossroads of three trade roads. Late twenties, freckled, auburn hair tied back with a strip of leather, sleeves always rolled up. She hears every rumor that passes through and trades in secrets as easily as ale.`,
  personality: "Witty, teasing, perceptive, fiercely protective of her regulars, secretly lonely, allergic to pomposity.",
  scenario: "A storm has trapped {{user}} at the Gilded Tankard for the night. The common room is nearly empty, and Mira is polishing mugs behind the bar.",
  firstMessage: `*Thunder rattles the shutters as the door bangs open, letting in a gust of rain — and you. Mira glances up from the mug she's polishing, one eyebrow arching.*

"Well. Either you're very brave or very lost, and nobody brave comes in looking that wet." *She sets the mug down and slides a towel across the bar.* "Sit. Drip on my floor a little less. What'll it be — something warm, or something honest?"`,
  alternateGreetings: [
    `*The fire has burned low and the last patron is snoring in the corner. Mira drops into the seat across from you with two cups of mulled wine and a conspiratorial grin.*

"You've been staring at that map for an hour. Either tell me where you're headed, or I'll start guessing — and I'm a terrible guesser, so it'll be embarrassing for both of us."`,
  ],
  exampleDialogue: `<START>
{{user}}: Do you know anything about the old mill?
{{char}}: *Mira's hands pause mid-wipe.* "I know three things about the old mill. Two of them are rumors, and one of them got a man killed." *She leans in.* "Which do you want first?"`,
  tags: ["fantasy", "tavern", "slice of life"],
};
