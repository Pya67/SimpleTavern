"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const USERSCRIPT_PATH = "/simple-tavern-janitor.user.js";
const FRAGMENT_PREFIX = "#janitor=";

/** base64url → UTF-8 JSON, as written by the userscript. */
function decodeJanitorFragment(hash: string): unknown {
  const b64 = hash.slice(FRAGMENT_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

/**
 * Receiving end of the "Send to SimpleTavern" userscript: it opens `<path>?import=janitor` with the
 * data in the address fragment (#janitor=…, never sent to the server). Reads it once, clears it from
 * the address bar and hands it to `onData`.
 */
export function useJanitorHandoff(path: string, what: string, onData: (data: Record<string, unknown>) => void) {
  const router = useRouter();
  const handled = useRef(false);
  const cb = useRef(onData);
  useEffect(() => {
    cb.current = onData;
  });
  useEffect(() => {
    if (handled.current || new URLSearchParams(window.location.search).get("import") !== "janitor") return;
    handled.current = true;
    const hash = window.location.hash;
    router.replace(path);
    if (!hash.startsWith(FRAGMENT_PREFIX)) {
      toast.error(`No ${what} came with that link`, { description: "Click Send to SimpleTavern on the JanitorAI page again. If it keeps happening, reinstall the userscript from Import → From JanitorAI." });
      return;
    }
    let data: unknown;
    try {
      data = decodeJanitorFragment(hash);
    } catch {
      toast.error(`The ${what} data from JanitorAI couldn't be read.`);
      return;
    }
    if (!data || typeof data !== "object") return void toast.error(`The ${what} data from JanitorAI couldn't be read.`);
    cb.current(data as Record<string, unknown>);
  }, [path, what, router]);
}

/** POSTs handed-over JanitorAI data to an import route and returns its JSON answer. */
export async function postJanitorImport<T>(url: string, data: unknown): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
    return (await res.json().catch(() => ({ ok: false, error: `Import failed (${res.status}).` }))) as ({ ok: true } & T) | { ok: false; error: string };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/** How to set up the userscript that adds a "Send to SimpleTavern" button on JanitorAI. */
export function JanitorSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const steps: React.ReactNode[] = [
    <>
      Install a userscript manager: <b>Tampermonkey</b> (Chrome or Firefox) or <b>Violentmonkey</b> (Firefox). In Chrome, also turn on <i>Allow user scripts</i> in the extension&apos;s details page.
    </>,
    <>
      Install the script:{" "}
      <a href={USERSCRIPT_PATH} target="_blank" rel="noreferrer" className="font-medium text-brand underline underline-offset-2">
        Send to SimpleTavern
      </a>
      . Your userscript manager opens an install page. If you installed it before, install it again to get lorebook support.
    </>,
    <>
      On a JanitorAI character or lorebook page, click <b>Send to SimpleTavern</b>. The first time, it asks for this app&apos;s address:
      <span className="mt-1.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-xs">{origin}</code>
        <Button size="xs" variant="outline" onClick={() => copyText(origin)}>
          <Copy /> Copy
        </Button>
      </span>
    </>,
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4 text-brand" /> Import from JanitorAI
          </DialogTitle>
          <DialogDescription>
            JanitorAI doesn&apos;t let other servers read its pages, so a small userscript adds a button to character and lorebook pages that sends them here from your browser.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">{i + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5">{s}</div>
            </li>
          ))}
        </ol>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>Characters come with the lorebooks attached to them on JanitorAI, linked automatically.</li>
          <li>If a creator hid a character&apos;s definition or a lorebook&apos;s entries, JanitorAI doesn&apos;t share them, so they can&apos;t be imported.</li>
          <li>Importing a lorebook you already have reuses your copy instead of making a duplicate.</li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function copyText(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Couldn't copy"),
  );
}
