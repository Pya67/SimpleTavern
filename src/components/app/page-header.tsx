"use client";
import { cn } from "cn";
import { SidebarToggle } from "@/components/app/app-shell";

export function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-20 flex items-center gap-2 bg-background/85 px-4 py-3 backdrop-blur-md md:px-6", className)}>
      <SidebarToggle className="-ml-1.5" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}
