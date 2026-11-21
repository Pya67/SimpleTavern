"use client";
import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOpts {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

const useConfirmStore = create<{ opts: ConfirmOpts | null; resolve: ((v: boolean) => void) | null }>(() => ({ opts: null, resolve: null }));

export function confirmDialog(opts: ConfirmOpts) {
  return new Promise<boolean>((resolve) => useConfirmStore.setState({ opts, resolve }));
}

/** Whether a confirm dialog is showing. */
export const useConfirmOpen = () => useConfirmStore((s) => !!s.opts);

export function ConfirmHost() {
  const { opts, resolve } = useConfirmStore();
  const close = (v: boolean) => {
    resolve?.(v);
    useConfirmStore.setState({ opts: null, resolve: null });
  };
  return (
    <AlertDialog open={!!opts} onOpenChange={(o) => !o && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={opts?.destructive ? "destructive" : "default"} onClick={() => close(true)}>
            {opts?.confirmLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
