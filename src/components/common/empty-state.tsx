"use client";
import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="relative">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-brand/10 blur-2xl" />
        <div className="surface-grain flex size-14 items-center justify-center rounded-2xl text-brand">
          <Icon className="size-6" />
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </motion.div>
  );
}
