"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FlaskConical, KeyRound, Plus, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityAvatar } from "@/components/common/avatar";
import { SidebarToggle } from "@/components/app/app-shell";
import { qk, useCharacters, useChats, useSettings } from "@/lib/client/queries";
import { rpc } from "@/lib/client/rpc";
import { groupByRecency, relativeTime } from "@/lib/format";
import { byEdited, ChatListRow } from "@/components/app/chat-list-row";
import { useUi } from "@/stores/ui";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView() {
  const { data: chats } = useChats();
  const { data: characters } = useCharacters();
  const { data: settings } = useSettings();
  const set = useUi((s) => s.set);
  const router = useRouter();
  const qc = useQueryClient();
  const sorted = chats ? [...chats].sort(byEdited) : undefined;
  const last = sorted?.[0];
  const groups = groupByRecency(sorted?.slice(1) ?? [], (c) => c.editedAt);

  const start = async (characterId: string) => {
    const r = await rpc("chats.create", { characterId });
    qc.invalidateQueries({ queryKey: qk.chats });
    router.push(`/chats/${r.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 flex h-12 items-center px-3">
        <SidebarToggle />
      </div>
      <div className="mx-auto max-w-4xl px-5 pb-16 pt-6 md:pt-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{greeting()}.</h1>
          <p className="mt-1.5 text-muted-foreground">The fire&apos;s lit. Who are we talking to tonight?</p>
        </motion.div>

        {settings && !settings.hasKey && !settings.mock && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 flex items-center gap-3 rounded-xl border border-brand/30 bg-brand/10 p-4">
            <KeyRound className="size-5 shrink-0 text-brand" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Connect OpenRouter</div>
              <div className="text-muted-foreground">Add your API key to start generating replies.</div>
            </div>
            <Button size="sm" render={<Link href="/settings" />}>
              Open settings
            </Button>
          </motion.div>
        )}
        {settings?.mock && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 flex items-center gap-3 rounded-xl border bg-card p-3.5 text-sm">
            <FlaskConical className="size-4 shrink-0 text-brand" />
            <div className="flex-1 text-muted-foreground">
              <span className="font-medium text-foreground">Mock mode.</span> OpenRouter is simulated locally, so no network calls and no cost. Set <code className="rounded bg-muted px-1 font-mono text-xs">OPENROUTER_MOCK=false</code> to use real models.
            </div>
          </motion.div>
        )}

        {last && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Link
              href={`/chats/${last.id}`}
              className="group mt-8 flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
            >
              <EntityAvatar name={last.characterName} src={last.characterAvatar} color={last.characterColor} size={52} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium uppercase tracking-wider text-brand">Continue</div>
                <div className="truncate text-lg font-semibold">{last.title}</div>
                <div className="text-sm text-muted-foreground">
                  with {last.characterName} · {relativeTime(last.editedAt)}
                </div>
              </div>
              <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
            </Link>
          </motion.div>
        )}

        {groups.length > 0 && (
          <>
            <div className="mt-10 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Your chats</h2>
              <Button variant="ghost" size="sm" render={<Link href="/chats" />}>
                By character <ArrowRight />
              </Button>
            </div>
            {groups.map(([label, items]) => (
              <section key={label} className="mt-3">
                <h3 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{label}</h3>
                <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                  {items.map((c) => (
                    <ChatListRow key={c.id} chat={c} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        <div className="mt-10 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Characters</h2>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" render={<Link href="/characters?import=1" />}>
              <Upload /> Import
            </Button>
            <Button variant="outline" size="sm" render={<Link href="/characters/new" />}>
              <Plus /> Create
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {characters?.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + Math.min(i, 12) * 0.03 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => start(c.id)}
              className="group flex flex-col items-center gap-2 rounded-2xl border bg-card p-4 text-center shadow-sm transition-colors hover:border-brand/40"
            >
              <EntityAvatar name={c.name} src={c.avatar} color={c.color} size={64} />
              <div className="w-full">
                <div className="truncate font-medium">{c.name}</div>
                <div className="line-clamp-2 min-h-8 text-xs text-muted-foreground">{c.tagline}</div>
              </div>
              <span className="flex items-center gap-1 text-xs text-brand opacity-0 transition-opacity group-hover:opacity-100">
                <Sparkles className="size-3" /> Start chat
              </span>
            </motion.button>
          ))}
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => router.push("/characters/new")}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-sm text-muted-foreground transition-colors hover:border-brand/50 hover:text-foreground"
          >
            <Plus className="size-5" /> New character
          </motion.button>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          Tip: press{" "}
          <button className="rounded border bg-muted px-1 font-mono" onClick={() => set({ paletteOpen: true })}>
            Ctrl K
          </button>{" "}
          to search everything, or <span className="rounded border bg-muted px-1 font-mono">?</span> for shortcuts.
        </p>
      </div>
    </div>
  );
}
