// Runs in every page while filming (loaded by capture.ts with addInitScript).
// Plain JS on purpose: functions passed from the .ts file get build helpers injected that break in the page.
(() => {
  const isPhone = window.__PROMO_PHONE === true;

  // Film in the Blue + Dark look.
  if (!sessionStorage.getItem("promo-init")) {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("st-accent", "blue");
    sessionStorage.setItem("promo-init", "1");
  }

  // No red spell-check squiggles in the composer.
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (el && el.matches && el.matches("textarea, input")) el.spellcheck = false;
    },
    true,
  );

  document.addEventListener("DOMContentLoaded", () => {
    // Hide the Next.js dev-tools badge.
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.appendChild(style);

    // Never show the OpenRouter key (Settings → Connection prints a masked copy and usage).
    const hideKey = () => {
      if (!location.pathname.startsWith("/settings")) return;
      for (const el of document.querySelectorAll("p, span, div")) {
        if (el.childElementCount === 0 && /sk-or-|\bsk-[a-z0-9-]{4,}/i.test(el.textContent || "")) el.style.visibility = "hidden";
      }
    };
    hideKey();
    new MutationObserver(hideKey).observe(document.body, { subtree: true, childList: true, characterData: true });

    if (isPhone) {
      // A soft finger dot that follows touches, so swipes read clearly.
      const dot = document.createElement("div");
      dot.style.cssText =
        "position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;pointer-events:none;z-index:2147483647;" +
        "background:oklch(0.85 0.1 350 / 0.35);box-shadow:0 0 0 2px oklch(0.9 0.08 350 / 0.9);opacity:0;transition:opacity 160ms ease";
      document.body.appendChild(dot);
      const at = (e) => {
        const t = e.touches[0];
        if (t) dot.style.transform = "translate(" + t.clientX + "px, " + t.clientY + "px)";
      };
      addEventListener("touchstart", (e) => { at(e); dot.style.opacity = "1"; }, { capture: true, passive: true });
      addEventListener("touchmove", at, { capture: true, passive: true });
      addEventListener("touchend", () => { dot.style.opacity = "0"; }, { capture: true, passive: true });
      return;
    }

    // A cute cursor with a click ripple (desktop).
    const cursor = document.createElement("div");
    cursor.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2.5l15 8.2-6.6 1.6-3.3 6.2z" fill="#f4f6fb" stroke="#1b2333" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    cursor.style.cssText =
      "position:fixed;left:0;top:0;margin:-3px 0 0 -3px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px rgb(0 0 0 / .45));transform:translate(800px,450px)";
    document.body.appendChild(cursor);
    addEventListener("mousemove", (e) => { cursor.style.transform = "translate(" + e.clientX + "px, " + e.clientY + "px)"; }, { capture: true, passive: true });
    addEventListener(
      "mousedown",
      (e) => {
        const ring = document.createElement("div");
        ring.style.cssText =
          "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;pointer-events:none;z-index:2147483646;" +
          "box-shadow:0 0 0 2px oklch(0.85 0.11 350);background:oklch(0.85 0.11 350 / .25);transition:transform 420ms cubic-bezier(.2,.7,.2,1),opacity 420ms ease";
        document.body.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = "scale(3)";
          ring.style.opacity = "0";
        });
        setTimeout(() => ring.remove(), 500);
      },
      { capture: true, passive: true },
    );
  });
})();
