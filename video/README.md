# SimpleTavern promo video ✧

This is a cute, Blue-themed promo made with [Remotion](https://www.remotion.dev): 1920×1080 at 60fps. Each scene is as long as its recording, plus a short lead-in and a ~1.6s linger, so the total length depends on the clips. With the current clips it's about 1:50.

| Scene | What's shown |
|---|---|
| Intro | The logo, with kaomoji cycling like the sidebar title |
| Chat | One whole streamed reply. Then a new message where `Ctrl + B` bolds a word and `Ctrl + I` italicises a second line. Then the model picker, filtered by "glm", picking GLM 4.7 Flash. Then the side panel, opened from the settings icon, going through every tab. |
| Actions | `→` streams a new version, then `↑` opens the edit box and stays there for a moment |
| Mobile | Swipe a reply left to retry it, then swipe your message left to edit it |
| Theme | Several accent colours, then Light, Black and Dark (the API key line is hidden) |
| Characters | The character grid and the JanitorAI import dialog (nothing is imported) |
| More | A 2×2 grid: lorebooks, sidebar drag & drop, personas (`Alt + P`), prompt templates |
| Setup | Running it locally needs only an OpenRouter key and Docker. Hosting uses a VPS and a remote database (see the README). |
| Outro | Closing card |

## Workflow

```powershell
npm install
```

You also need `ffmpeg` with libx264 on your PATH. If it isn't on your PATH, set `FFMPEG` to its full path.

1. In the app folder, start the dev server without the login screen, using real models:

   ```powershell
   $env:AUTH_BYPASS="true"; $env:OPENROUTER_MOCK="false"; pnpm dev
   ```

2. Record the clips:

   ```powershell
   npm run capture
   ```

   To record just some of them:

   ```powershell
   npm run capture -- chat mobile
   ```

3. Preview and tweak in Remotion Studio:

   ```powershell
   npm run dev
   ```

4. Render the final video to `out/promo.mp4`:

   ```powershell
   npm run render
   ```

### What capture touches

- **A temporary chat** called "study date ♡" with `PROMO_CHARACTER` (default "Asa Mitaka"). The replies are real generations, so they cost a few cents.
- **Your preset's model.** Picking GLM 4.7 Flash on camera edits the preset, so every preset's model is put back right after that shot.
- **Two temporary directories**, used for the drag-and-drop shot.
- **Your accent colour**, which is switched to Blue for filming.

All of these are deleted or restored at the end, even if a shot fails.

## How it stays smooth

- **Sharp frames.** Frames come from `page.screencast` with their real timestamps, and ffmpeg lays them onto a constant 60fps H.264 timeline. Still endings are held until recording stops.
- **No resampling.** Desktop clips are recorded at 1600×900 and phone clips at 430×932, and each is shown at exactly that size.
- **No shaking.** Frames ease in once and then stay completely still.
- **No waiting on the model.** Time spent waiting for the first token is cut out automatically (`segments` in `src/clips.json`).
- **A drawn cursor and finger dot.** These come from `scripts/page-init.js`. Playwright's built-in action overlay added ~2s to every click while recording.
- **Clean crossfades.** Scenes cross-dissolve, and the new scene rises gently into place.

## What to edit

- **Captions, kaomojis and scene order:** `src/Promo.tsx` and `src/scenes/Scenes.tsx`.
- **Transition length, lead-in, linger, colours and fonts:** `src/theme.ts`.
- **What each clip does:** the `shots` in `scripts/capture.ts`.
- **Music:** see the comment at the bottom of `src/Promo.tsx`.
