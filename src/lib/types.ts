export type LoreSelectiveLogic = "and_any" | "and_all" | "not_any" | "not_all";

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export const REASONING_EFFORTS: ReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];

/** Per-model preferences that override the preset (keyed by model id). */
export interface ModelPref {
  reasoningEffort?: ReasoningEffort;
}
export type ModelPrefs = Record<string, ModelPref>;

export interface PresetParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  topA?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  maxTokens?: number;
  seed?: number;
  stop?: string[];
  reasoning?: {
    enabled: boolean;
    effort?: ReasoningEffort;
    maxTokens?: number;
    exclude?: boolean;
  };
  /** Ask the model for replies of roughly this many words (0/undefined = no instruction). */
  targetWords?: number;
  providerOrder?: string[];
  allowFallbacks?: boolean;
  middleOut?: boolean;
  /** Raw JSON merged into the request body (advanced). */
  extraBody?: string;
}

export type PromptBlockKind =
  | "main"
  | "char_description"
  | "char_personality"
  | "scenario"
  | "persona"
  | "examples"
  | "lore_before"
  | "lore_after"
  | "memory"
  | "facts"
  | "history"
  | "post_history"
  | "custom";

export interface PromptBlock {
  id: string;
  kind: PromptBlockKind;
  enabled: boolean;
  role: "system" | "user" | "assistant";
  /** Used for `main`, `custom`, and as a wrapper template for others (`{{content}}`). */
  content?: string;
  label?: string;
}

export interface CompactionSettings {
  enabled: boolean;
  /** Model used for summarization. Empty = same as chat model. */
  modelId: string;
  /** Compact when uncompacted history exceeds this fraction of the history budget. */
  thresholdPct: number;
  /** Always keep at least this many most recent messages verbatim. */
  keepRecent: number;
  /** Approximate tokens of messages per level-0 summary. */
  chunkTokens: number;
  /** Merge level-N chunks once there are more than this many. */
  mergeAfter: number;
  prompt: string;
  mergePrompt: string;
}

export interface UiPrefs {
  layout: "bubbles" | "book";
  fontSize: number;
  /** Opacity of message text, 0.3–1. */
  textOpacity: number;
  chatWidth: "narrow" | "normal" | "wide";
  enterToSend: boolean;
  showStats: boolean;
  accent: string;
  /** Message avatar size in px. */
  avatarSize?: number;
  /** Profile picture shape: circle, rounded or square. */
  avatarShape?: string;
  /** Font id from lib/fonts for the whole interface. */
  appFont?: string;
  /** Font id for message text, or "auto" to follow the layout. */
  chatFont?: string;
  /** Hex colour used when accent is "custom". */
  customAccent?: string;
  streamSmoothing: boolean;
  /** Model providers (id prefix, e.g. "anthropic") shown in model pickers. Empty/missing = all. */
  modelProviders?: string[];
}

export interface TokenBreakdownItem {
  label: string;
  kind: string;
  tokens: number;
}

export interface PromptBreakdown {
  items: TokenBreakdownItem[];
  total: number;
  budget: number;
  contextSize: number;
  historyIncluded: number;
  historyDropped: number;
  compactedCovered: number;
  loreFired: { id: string; comment: string; keys: string[]; reason: string }[];
}
