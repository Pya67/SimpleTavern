"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const router = useRouter();
  const params = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    setBusy(false);
    if (res.ok) {
      // Only follow in-app paths, so a crafted ?next= can't send you to another site after signing in.
      const next = params.get("next") ?? "";
      // Keep the #fragment: the JanitorAI userscript sends the character there, and it must survive signing in.
      router.replace(next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next + window.location.hash : "/");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "Sign in failed");
      setShake((s) => s + 1);
    }
  }

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, x: shake ? [0, -10, 9, -6, 4, 0] : 0 }}
      key={shake}
      transition={{ duration: shake ? 0.4 : undefined }}
      className="relative w-full max-w-sm rounded-2xl border bg-card/80 p-8 shadow-2xl backdrop-blur"
    >
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-brand/15 text-brand">
          <LockKeyhole className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">The tavern is only open to its keeper.</p>
        </div>
      </div>
      <Input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        className="h-10"
        aria-invalid={!!err}
      />
      <div className="h-6 pt-1.5 text-sm text-destructive">{err}</div>
      <Button type="submit" className="mt-1 h-10 w-full bg-brand text-brand-foreground hover:bg-brand/90" disabled={busy || !pw}>
        {busy ? <Loader2 className="animate-spin" /> : "Enter"}
      </Button>
    </motion.form>
  );
}
