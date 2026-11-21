/** The app's kaomoji set, grouped by mood. Used for default profile pictures and the sidebar title. */
export const KAOMOJI_GROUPS = [
  { mood: "Happy", items: ["(◕‿◕)", "(＾▽＾)", "ヽ(・∀・)ﾉ", "(≧◡≦)", "(✿◠‿◠)", "٩(◕‿◕)۶", "(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧"] },
  { mood: "Love", items: ["(♡˙︶˙♡)", "(｡♥‿♥｡)", "(´｡• ᵕ •｡`) ♡", "(づ￣ ³￣)づ", "( ˘ ³˘)♥"] },
  { mood: "Smug / Sus", items: ["(¬‿¬)", "( ͡° ͜ʖ ͡°)", "(￢‿￢ )", "( ͡~ ͜ʖ ͡°)", "(๑˃ᴗ˂)ﻭ"] },
  { mood: "Sad", items: ["(╥﹏╥)", "(ಥ﹏ಥ)", "(｡•́︿•̀｡)", "(っ˘̩╭╮˘̩)っ", "(´；ω；`)"] },
  { mood: "Angry", items: ["(╬ Ò﹏Ó)", "(ノಠ益ಠ)ノ彡┻━┻", "(ง'̀-'́)ง", "ヽ(｀Д´)ﾉ", "(╯°□°)╯︵ ┻━┻"] },
  { mood: "Shocked / Confused", items: ["(⊙_⊙)", "(°ロ°)", "(・_・;)", "(￣ω￣;)", "¯\\_(ツ)_/¯"] },
  { mood: "Animals", items: ["ʕ•ᴥ•ʔ", "(=^･ω･^=)", "ฅ^•ﻌ•^ฅ", "U・ᴥ・U", "(・Θ・)"] },
] as const;

export const KAOMOJIS: readonly string[] = KAOMOJI_GROUPS.flatMap((g) => g.items);

/** Visible character count (combining marks don't add width). */
export const kaomojiLength = (k: string) => k.replace(/\p{M}/gu, "").length;

/**
 * Faces short enough to stay readable inside a small round avatar.
 * The long ones (table flips, sparkles) still appear in the sidebar title.
 */
export const AVATAR_KAOMOJIS: readonly string[] = KAOMOJIS.filter((k) => kaomojiLength(k) <= 10);

/** A stable kaomoji for a name: the same character always gets the same face. */
export function kaomojiFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_KAOMOJIS[Math.abs(h) % AVATAR_KAOMOJIS.length];
}
