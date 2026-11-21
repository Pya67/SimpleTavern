"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { CircleCheck, CircleX, Info, Loader2, TriangleAlert } from "lucide-react";
import { MotionConfig } from "motion/react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/client/rpc";
import { useIsMobile } from "@/hooks/use-media";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
          },
        },
      }),
  );
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" themes={["light", "dark", "black"]} enableSystem disableTransitionOnChange>
      <QueryClientProvider client={qc}>
        <NuqsAdapter>
          <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.8 }}>
            <TooltipProvider delay={350}>{children}</TooltipProvider>
          </MotionConfig>
        </NuqsAdapter>
        <AppToaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** All toasts and notifications (sonner), bottom right (top on phones), following the app's own theme. */
function AppToaster() {
  const { resolvedTheme } = useTheme();
  const isMobile = useIsMobile();
  return (
    <Toaster
      // On phones toasts sit at the top, clear of the message box and keyboard.
      position={isMobile ? "top-center" : "bottom-right"}
      theme={resolvedTheme === "light" ? "light" : "dark"}
      // Short by default; toasts with Undo pass a longer duration (UNDO_DURATION).
      duration={2500}
      // On phones toasts span the width; keep them below the notch / status bar.
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      // Dismiss with the × button, or swipe a toast away towards its edge.
      closeButton
      swipeDirections={isMobile ? ["top", "left", "right"] : ["right", "bottom"]}
      icons={{
        success: <CircleCheck className="size-4 text-emerald-500" />,
        info: <Info className="size-4 text-sky-500" />,
        warning: <TriangleAlert className="size-4 text-amber-500" />,
        error: <CircleX className="size-4 text-destructive" />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!bg-popover !text-popover-foreground !border-border !rounded-xl !shadow-lg !gap-2.5 !py-3",
          description: "!text-muted-foreground",
          closeButton: "!border-border !bg-popover !text-muted-foreground transition-colors hover:!bg-accent hover:!text-foreground",
          actionButton:
            "!h-7 !rounded-lg !border !border-brand/40 !bg-brand/15 !px-2.5 !text-xs !font-medium !text-foreground transition-colors hover:!bg-brand/25",
        },
      }}
    />
  );
}
