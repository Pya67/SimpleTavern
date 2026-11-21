"use client";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { rpc, type ProcInput, type ProcName, type ProcOutput } from "@/lib/client/rpc";

export const qk = {
  settings: ["settings"] as const,
  models: ["models"] as const,
  personas: ["personas"] as const,
  characters: ["characters"] as const,
  character: (id: string) => ["character", id] as const,
  presets: ["presets"] as const,
  templates: ["templates"] as const,
  lorebooks: ["lorebooks"] as const,
  lorebook: (id: string) => ["lorebook", id] as const,
  chats: ["chats"] as const,
  directories: ["directories"] as const,
  chat: (id: string) => ["chat", id] as const,
  memory: (id: string) => ["memory", id] as const,
  inspect: (id: string) => ["inspect", id] as const,
};

export function useRpcQuery<K extends ProcName>(
  key: readonly unknown[],
  name: K,
  input: ProcInput<K>,
  opts?: Omit<UseQueryOptions<ProcOutput<K>>, "queryKey" | "queryFn">,
) {
  return useQuery<ProcOutput<K>>({ queryKey: key, queryFn: () => rpc(name, input), ...opts });
}

export const useSettings = () => useRpcQuery(qk.settings, "settings.get", {}, { staleTime: 60_000 });
export const useModels = () => useRpcQuery(qk.models, "models.list", {}, { staleTime: 60 * 60_000 });
export const usePersonas = () => useRpcQuery(qk.personas, "personas.list", {}, { staleTime: 30_000 });
export const useCharacters = () => useRpcQuery(qk.characters, "characters.list", {});
export const usePresets = () => useRpcQuery(qk.presets, "presets.list", {}, { staleTime: 30_000 });
export const useTemplates = () => useRpcQuery(qk.templates, "templates.list", {}, { staleTime: 30_000 });
export const useLorebooks = () => useRpcQuery(qk.lorebooks, "lorebooks.list", {});
export const useChats = () => useRpcQuery(qk.chats, "chats.list", {});
export const useDirectories = () => useRpcQuery(qk.directories, "directories.list", {});

export function useRpcMutation<K extends ProcName>(name: K, opts?: { invalidate?: readonly (readonly unknown[])[]; onSuccess?: (d: ProcOutput<K>, v: ProcInput<K>) => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProcInput<K>) => rpc(name, input),
    onSuccess: (d, v) => {
      opts?.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts?.onSuccess?.(d, v);
    },
  });
}

export type ModelInfo = ProcOutput<"models.list">[number];
export type PersonaT = ProcOutput<"personas.list">[number];
export type PresetT = ProcOutput<"presets.list">[number];
export type CharacterListItem = ProcOutput<"characters.list">[number];
export type ChatListItem = ProcOutput<"chats.list">[number];
export type DirectoryT = ProcOutput<"directories.list">[number];
export type MessageV = ProcOutput<"chats.messages">["messages"][number];
export type ChatInfo = ProcOutput<"chats.get">;
