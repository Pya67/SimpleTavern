// ==UserScript==
// @name         Send to SimpleTavern
// @namespace    sussy-tavern
// @version      1.4.0
// @description  Adds a "Send to SimpleTavern" button to JanitorAI character and lorebook pages that imports them (characters with their lorebooks) into your SimpleTavern.
// @match        https://janitorai.com/*
// @match        https://www.janitorai.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * How it works: when you're signed in, JanitorAI's own page loads the full character (including
 * the definition, if the creator shares it) or lorebook — built into the page on a fresh load, or as
 * a response when you browse within the site. This script reads it from there; it never reads your
 * login. A character only lists its lorebooks by name, so to send those along the script asks
 * JanitorAI for each one, from your browser, the same way their lorebook page does. When you click the
 * button, your SimpleTavern opens in a new tab with the character in the address after "#" (never
 * sent to any server). SimpleTavern asks you to confirm, then imports it. Nothing goes anywhere
 * except the SimpleTavern address you set.
 *
 * Works with Tampermonkey or Violentmonkey in Firefox and Chrome.
 */
(function () {
  "use strict";

  const KEY = "sussyTavernUrl";
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const FRAGMENT_KEY = "janitor";
  const EVENT = "sussy-tavern:character";

  // ---- Keep a copy of the characters JanitorAI's page loads ----------------------------------
  // The page loads characters itself (with your session). A tiny hook runs in the page and passes
  // each character response it sees back to this script; nothing else is touched or sent.
  /** id → the most recent character JSON the page received. */
  const seen = new Map();
  document.addEventListener(EVENT, (e) => {
    try {
      const j = JSON.parse(e.detail);
      if (j && typeof j.id === "string") seen.set(j.id.toLowerCase(), j);
    } catch {}
  });
  function pageHook(EVENT) {
    const RE = /\/hampter\/(?:characters|script)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[?#]|$)/i;
    const pass = (url, text) => {
      if (RE.test(String(url)) && typeof text === "string" && text.charAt(0) === "{") document.dispatchEvent(new CustomEvent(EVENT, { detail: text }));
    };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__sussyUrl = url;
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        try {
          if (this.status === 200 && (this.responseType === "" || this.responseType === "text")) pass(this.__sussyUrl, this.responseText);
        } catch (e) {}
      });
      return send.apply(this, arguments);
    };
    const f = window.fetch;
    window.fetch = function (input) {
      const p = f.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : (input && input.url) || String(input);
        if (RE.test(url)) p.then((r) => r.ok && r.clone().text().then((t) => pass(url, t))).catch(() => {});
      } catch (e) {}
      return p;
    };
  }
  // Runs in the page itself (a userscript's own copy of XMLHttpRequest isn't the one the page uses).
  const hook = document.createElement("script");
  hook.textContent = "(" + pageHook.toString() + ")(" + JSON.stringify(EVENT) + ");";
  (document.head || document.documentElement).appendChild(hook);
  hook.remove();

  /** Normalises what the user typed into an origin-style base URL, or returns null. */
  function cleanUrl(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = (/^(localhost|127\.|\[::1\])/i.test(s) ? "http://" : "https://") + s;
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return (u.origin + u.pathname).replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  function askForUrl() {
    const current = GM_getValue(KEY, "");
    const typed = prompt("Your SimpleTavern address (where you open the app), e.g. https://tavern.example.com or http://localhost:3000", current || "http://localhost:3000");
    if (typed === null) return current || null;
    const url = cleanUrl(typed);
    if (!url) {
      alert("That doesn't look like a web address. Try something like https://tavern.example.com");
      return current || null;
    }
    GM_setValue(KEY, url);
    return url;
  }

  GM_registerMenuCommand("Set SimpleTavern address…", askForUrl);

  /** The character or lorebook ("script") this page shows, or null. */
  function currentPage() {
    const m = location.pathname.match(/^\/(characters|scripts)\/([^/?#]+)/);
    const id = m ? (m[2].match(UUID) || [])[0] : null;
    return id ? { kind: m[1] === "scripts" ? "lorebook" : "character", id: id.toLowerCase() } : null;
  }

  // ---- Button -------------------------------------------------------------------------------

  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = "Import this into SimpleTavern (change the address from your userscript manager's menu)";
  Object.assign(btn.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483647",
    display: "none",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    border: "none",
    borderRadius: "999px",
    font: "600 14px/1.2 system-ui, -apple-system, Segoe UI, sans-serif",
    color: "#0f1115",
    background: "#b9c7ff",
    boxShadow: "0 6px 24px rgba(0,0,0,.35)",
    cursor: "pointer",
  });
  const LABEL = "Send to SimpleTavern";
  btn.textContent = LABEL;
  let busy = false;

  function setLabel(text, resetAfterMs) {
    btn.textContent = text;
    if (resetAfterMs) setTimeout(() => !busy && (btn.textContent = LABEL), resetAfterMs);
  }

  function sync() {
    if (!document.body) return;
    if (!btn.isConnected) document.body.appendChild(btn);
    btn.style.display = currentPage() ? "inline-flex" : "none";
  }
  // JanitorAI is a single-page app: the URL changes without a reload, so keep checking.
  setInterval(sync, 800);
  sync();

  btn.addEventListener("click", async () => {
    if (busy) return;
    const page = currentPage();
    if (!page) return;
    const base = GM_getValue(KEY, "") || askForUrl();
    if (!base) return;
    busy = true;
    try {
      if (page.kind === "lorebook") await sendLorebook(base, page.id);
      else await sendCharacter(base, page.id);
    } finally {
      busy = false;
    }
  });

  async function sendCharacter(base, id) {
    // Prefer what the page itself loaded (it has the definition when you're signed in): a response
    // seen while browsing within the site, else the data built into the page on a fresh load.
    let data = seen.get(id) || fromEmbedded(id, isCharacter);
    if (!data) {
      setLabel("Reading character…");
      try {
        data = await getJson("/hampter/characters/" + id, "this character");
        if (!data || String(data.id).toLowerCase() !== id) throw new Error("JanitorAI sent something unexpected.");
      } catch (e) {
        setLabel(LABEL);
        alert("Couldn't read this character: " + (e && e.message ? e.message : e));
        return;
      }
      if (data.showdefinition && !data.personality) {
        setLabel(LABEL);
        // The fallback request can't see the definition; a fresh page load lets us keep the page's own copy.
        if (confirm("The definition wasn't captured for this character yet. Reload the page and click Send again?\n\n(Cancel to send it without the definition.)")) return location.reload();
      }
    }

    // The character only lists its lorebooks; read each one so they arrive with it.
    const payload = pick(data);
    const refs = (Array.isArray(data.scripts) ? data.scripts : []).filter((s) => s && s.type === "lorebook" && typeof s.id === "string").slice(0, 20);
    if (refs.length) {
      payload.lorebooks = [];
      payload.lorebook_errors = [];
      for (let i = 0; i < refs.length; i++) {
        setLabel("Reading lorebooks (" + (i + 1) + "/" + refs.length + ")…");
        try {
          const book = await readLorebook(refs[i].id.toLowerCase());
          if (book.type && book.type !== "lorebook") continue;
          if (book.script == null) payload.lorebook_errors.push({ title: book.title || refs[i].title, reason: "The creator keeps this lorebook's entries private." });
          else payload.lorebooks.push(pickLorebook(book));
        } catch (e) {
          payload.lorebook_errors.push({ title: refs[i].title, reason: e && e.message ? e.message : String(e) });
        }
      }
    }
    openTavern(base + "/characters?import=janitor", payload);
  }

  async function sendLorebook(base, id) {
    let data;
    try {
      setLabel("Reading lorebook…");
      data = await readLorebook(id);
    } catch (e) {
      setLabel(LABEL);
      alert("Couldn't read this lorebook: " + (e && e.message ? e.message : e));
      return;
    }
    if (data.type && data.type !== "lorebook") {
      setLabel(LABEL);
      alert("This script is code, not a lorebook. SimpleTavern can only import lorebooks.");
      return;
    }
    if (data.script == null) {
      setLabel(LABEL);
      alert("The creator keeps this lorebook's entries private, so it can't be imported.");
      return;
    }
    openTavern(base + "/lorebooks?import=janitor", pickLorebook(data));
  }

  /** A lorebook as the page loaded it, else asked from JanitorAI the way their lorebook page does. */
  async function readLorebook(id) {
    const have = seen.get(id) || fromEmbedded(id, isLorebook);
    if (have && "script" in have) return have;
    const data = await getJson("/hampter/script/" + id, "this lorebook");
    if (!data || String(data.id).toLowerCase() !== id) throw new Error("JanitorAI sent something unexpected.");
    seen.set(id, data);
    return data;
  }

  async function getJson(path, what) {
    const res = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "JanitorAI wouldn't share " + what + ". Are you signed in to JanitorAI?" : "JanitorAI answered with an error (" + res.status + ").");
    return res.json();
  }

  function openTavern(target, payload) {
    // The data travels in the part of the address after "#": browsers never send that to the
    // server, and SimpleTavern removes it from the address bar as soon as it has read it.
    const url = target + "#" + FRAGMENT_KEY + "=" + encodePayload(payload);
    try {
      if (typeof GM_openInTab === "function") GM_openInTab(url, { active: true, insert: true });
      else if (!window.open(url, "_blank")) throw new Error("blocked");
      setLabel("Sent ✓", 4000);
    } catch {
      alert("Couldn't open SimpleTavern. Allow pop-ups for janitorai.com and try again.");
      setLabel(LABEL);
    }
  }

  const isCharacter = (o) => "name" in o && ("personality" in o || "first_messages" in o);
  const isLorebook = (o) => "script" in o && "title" in o;

  /**
   * On a fresh page load JanitorAI doesn't request the character separately: it's built into the
   * page as `window.mbxM.push(JSON.parse("…"))`. Find the character or lorebook with this id in that data.
   */
  function fromEmbedded(id, matches) {
    const want = id.toLowerCase();
    const find = (o, depth) => {
      if (!o || typeof o !== "object" || depth > 8) return null;
      if (typeof o.id === "string" && o.id.toLowerCase() === want && matches(o)) return o;
      for (const v of Object.values(o)) {
        const hit = find(v, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    for (const s of document.scripts) {
      const t = s.textContent;
      if (s.src || !t.includes(want) || !t.includes("JSON.parse(")) continue;
      const re = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/g;
      let m;
      while ((m = re.exec(t))) {
        try {
          const hit = find(JSON.parse(JSON.parse(m[1])), 0);
          if (hit) return hit;
        } catch {}
      }
    }
    return null;
  }

  /** Only the fields SimpleTavern uses, which keeps the address short. */
  function pick(d) {
    const keep = ["id", "name", "chat_name", "description", "personality", "scenario", "first_message", "first_messages", "example_dialogs", "avatar", "custom_tags", "creator_name", "showdefinition", "is_deleted", "is_force_remove"];
    const out = {};
    for (const k of keep) if (d[k] !== undefined) out[k] = d[k];
    out.tags = Array.isArray(d.tags) ? d.tags.map((t) => ({ name: t && t.name })) : [];
    return out;
  }

  /** Only what SimpleTavern needs from a lorebook (not the list of characters using it), to keep the address short. */
  function pickLorebook(d) {
    const keep = ["name", "comment", "key", "keys", "keysRaw", "keywordsRaw", "keysecondary", "keysecondaryRaw", "selectiveLogic", "content", "constant", "activationMode", "placement", "placementPosition", "depth", "insertion_order", "priority", "probability", "case_sensitive", "matchWholeWords", "enabled"];
    let entries = d.script;
    try {
      if (typeof entries === "string") entries = JSON.parse(entries);
    } catch {}
    if (Array.isArray(entries))
      entries = entries.map((e) => {
        const out = {};
        for (const k of keep) if (e && e[k] !== undefined) out[k] = e[k];
        return out;
      });
    return { id: d.id, type: d.type, title: d.title, description: d.description, depth: d.depth, settings: d.settings, is_code_public: d.is_code_public, script: entries };
  }

  /** JSON → UTF-8 → base64url, safe to put in an address. */
  function encodePayload(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
})();
