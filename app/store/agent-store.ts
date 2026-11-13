"use client";

import { create } from "zustand";
import {
  sessionSetter,
  walletSessionIsCurrent,
} from "@/services/wallet-session";
import { ApiError, getAgentThreadMessages, streamAgentMessage } from "@/services";
import type {
  AgentDisplayMessage,
  AgentPageContext,
  AgentRecentThread,
  AgentRequest,
  AgentStreamEvent,
} from "@/types";

const RECENTS_KEY = "oren-agent-recents-v1";
const PANEL_KEY = "oren-agent-panel-v1";
const MAX_RECENTS = 12;
let activeController: AbortController | undefined;

interface AgentState {
  walletAddress?: string;
  threadId?: string;
  messages: AgentDisplayMessage[];
  recentThreads: AgentRecentThread[];
  panelOpen: boolean;
  expanded: boolean;
  hydrated: boolean;
  isLoadingHistory: boolean;
  isSending: boolean;
  error?: string;
  lastRequest?: AgentRequest;
  initialize: (walletAddress?: string) => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  newChat: () => void;
  loadThread: (threadId: string) => Promise<void>;
  sendMessage: (
    message: string,
    walletAddress: string,
    context?: AgentPageContext,
  ) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  recentThreads: [],
  panelOpen: false,
  expanded: false,
  hydrated: false,
  isLoadingHistory: false,
  isSending: false,

  async initialize(walletAddress) {
    const update = sessionSetter(set);
    if (get().walletAddress === walletAddress && get().hydrated) return;
    activeController?.abort();
    activeController = undefined;

    const panelPreference = readPanelPreference(walletAddress);
    const panelOpen = panelPreference
      ? panelPreference.open
      : typeof window !== "undefined" &&
        window.matchMedia("(min-width: 1024px)").matches;
    if (!panelPreference) writePanelPreference(walletAddress, panelOpen);

    if (!walletAddress) {
      update({
        walletAddress: undefined,
        threadId: undefined,
        messages: [],
        recentThreads: [],
        panelOpen,
        expanded: false,
        hydrated: true,
        isLoadingHistory: false,
        lastRequest: undefined,
        isSending: false,
        error: undefined,
      });
      return;
    }

    const recentThreads = readRecents()[walletAddress] ?? [];
    update({
      walletAddress,
      threadId: undefined,
      messages: [],
      recentThreads,
      panelOpen,
      expanded: false,
      hydrated: true,
      isLoadingHistory: false,
      lastRequest: undefined,
      isSending: false,
      error: undefined,
    });
    if (recentThreads[0]) await get().loadThread(recentThreads[0].id);
  },

  setPanelOpen(panelOpen) {
    writePanelPreference(get().walletAddress, panelOpen);
    set(panelOpen ? { panelOpen } : { panelOpen, expanded: false });
  },

  setExpanded(expanded) {
    set({ expanded });
  },

  newChat() {
    if (get().isSending) return;
    set({
      threadId: undefined,
      messages: [],
      error: undefined,
      lastRequest: undefined,
    });
  },

  async loadThread(threadId) {
    const update = sessionSetter(set);
    const isCurrent = walletSessionIsCurrent();
    const walletAddress = get().walletAddress;
    if (!walletAddress || get().isSending) return;
    update({ isLoadingHistory: true, error: undefined });
    try {
      const response = await getAgentThreadMessages(threadId, walletAddress);
      if (!isCurrent()) return;
      update({
        threadId,
        messages: response.messages,
        isLoadingHistory: false,
      });
      touchRecent(update, walletAddress, threadId);
    } catch (error) {
      if (!isCurrent()) return;
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load this conversation";
      // Auth and transport failures happen before the thread is known to be gone.
      if (shouldDropSavedRecent(error)) {
        removeRecent(update, walletAddress, threadId);
      }
      update({
        threadId: undefined,
        messages: [],
        isLoadingHistory: false,
        error: message,
      });
    }
  },

  async sendMessage(message, walletAddress, context) {
    const update = sessionSetter(set);
    const isCurrent = walletSessionIsCurrent();
    const content = message.trim();
    if (!content || get().isSending) return;
    const request: AgentRequest = {
      walletAddress,
      threadId: get().threadId,
      message: content,
      context,
    };
    const optimisticUserId = `user-${crypto.randomUUID()}`;
    const streamingAssistantId = `assistant-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const controller = new AbortController();
    activeController = controller;

    update((state) => ({
      messages: [
        ...state.messages.map((item) => ({ ...item, interrupted: false })),
        { id: optimisticUserId, role: "user", content, createdAt: now },
        {
          id: streamingAssistantId,
          role: "assistant",
          content: "",
          createdAt: now,
          streaming: true,
          activities: [],
          artifacts: [],
        },
      ],
      isSending: true,
      error: undefined,
      lastRequest: request,
    }));

    try {
      await streamAgentMessage(
        request,
        (event) => {
          if (isCurrent())
            applyStreamEvent(
              update,
              get,
              event,
              optimisticUserId,
              streamingAssistantId,
              content,
            );
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        update((state) => ({
          isSending: false,
          messages: state.messages
            .filter((item) => item.id !== streamingAssistantId || item.content)
            .map((item) =>
              item.id === streamingAssistantId
                ? { ...item, streaming: false, interrupted: true }
                : item,
            ),
        }));
      } else {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to reach Oren";
        update((state) => ({
          isSending: false,
          error: errorMessage,
          messages: state.messages.map((item) =>
            item.id === streamingAssistantId
              ? { ...item, streaming: false, interrupted: true }
              : item,
          ),
        }));
      }
    } finally {
      if (activeController === controller) activeController = undefined;
    }
  },

  stop() {
    activeController?.abort();
  },

  async retry() {
    const update = sessionSetter(set);
    const request = get().lastRequest;
    if (!request || get().isSending) return;
    update((state) => {
      const unansweredIndex = state.messages.findLastIndex(
        (item) => item.role === "user" && item.content === request.message,
      );
      return {
        messages:
          unansweredIndex >= 0
            ? state.messages.slice(0, unansweredIndex)
            : state.messages,
        error: undefined,
      };
    });
    await get().sendMessage(
      request.message,
      request.walletAddress,
      request.context,
    );
  },
}));

function applyStreamEvent(
  set: Parameters<typeof useAgentStore.setState>[0] extends never
    ? never
    : typeof useAgentStore.setState,
  get: typeof useAgentStore.getState,
  event: AgentStreamEvent,
  optimisticUserId: string,
  streamingAssistantId: string,
  titleSource: string,
) {
  if (event.type === "turn_started") {
    set((state) => ({
      threadId: event.threadId,
      messages: state.messages.map((item) =>
        item.id === optimisticUserId ? event.message : item,
      ),
    }));
    touchRecent(set, get().walletAddress!, event.threadId, titleSource);
    return;
  }

  if (event.type === "assistant_reset") {
    set((state) => ({
      messages: updateMessage(
        state.messages,
        streamingAssistantId,
        (message) => ({
          ...message,
          content: "",
        }),
      ),
    }));
    return;
  }

  if (event.type === "assistant_delta") {
    set((state) => ({
      messages: updateMessage(
        state.messages,
        streamingAssistantId,
        (message) => ({
          ...message,
          content: message.content + event.delta,
        }),
      ),
    }));
    return;
  }

  if (event.type === "tool_started") {
    set((state) => ({
      messages: updateMessage(
        state.messages,
        streamingAssistantId,
        (message) => ({
          ...message,
          activities: [
            ...(message.activities ?? []),
            {
              callId: event.callId,
              toolName: event.toolName,
              status: "running",
            },
          ],
        }),
      ),
    }));
    return;
  }

  if (event.type === "tool_completed" || event.type === "tool_failed") {
    set((state) => ({
      messages: updateMessage(
        state.messages,
        streamingAssistantId,
        (message) => ({
          ...message,
          activities: (message.activities ?? []).map((activity) =>
            activity.callId === event.callId
              ? {
                  ...activity,
                  status:
                    event.type === "tool_completed" ? "completed" : "failed",
                  error: event.type === "tool_failed" ? event.error : undefined,
                }
              : activity,
          ),
          artifacts:
            event.type === "tool_completed" && event.artifact
              ? [...(message.artifacts ?? []), event.artifact]
              : message.artifacts,
        }),
      ),
    }));
    return;
  }

  if (event.type === "turn_completed") {
    set((state) => ({
      threadId: event.threadId,
      isSending: false,
      error: undefined,
      messages: state.messages.map((item) =>
        item.id === streamingAssistantId
          ? {
              ...event.message,
              streaming: false,
              artifacts: event.artifacts ?? event.message.artifacts,
            }
          : item,
      ),
    }));
    touchRecent(set, get().walletAddress!, event.threadId);
    return;
  }

  if (event.type === "turn_failed") {
    set((state) => ({
      isSending: false,
      error: event.error.message,
      messages: state.messages.map((item) =>
        item.id === streamingAssistantId
          ? { ...item, streaming: false, interrupted: true }
          : item,
      ),
    }));
  }
}

function updateMessage(
  messages: AgentDisplayMessage[],
  id: string,
  update: (message: AgentDisplayMessage) => AgentDisplayMessage,
) {
  return messages.map((message) =>
    message.id === id ? update(message) : message,
  );
}

/** A saved shortcut is stale only when this thread itself is missing or not ours. */
export function shouldDropSavedRecent(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 400 || error.status === 404)
  );
}

function touchRecent(
  set: typeof useAgentStore.setState,
  walletAddress: string,
  threadId: string,
  titleSource?: string,
) {
  const all = readRecents();
  const current = all[walletAddress] ?? [];
  const existing = current.find((item) => item.id === threadId);
  const title = existing?.title ?? makeTitle(titleSource ?? "New conversation");
  const recent = [
    { id: threadId, title, updatedAt: new Date().toISOString() },
    ...current.filter((item) => item.id !== threadId),
  ].slice(0, MAX_RECENTS);
  all[walletAddress] = recent;
  writeRecents(all);
  set({ recentThreads: recent });
}

function removeRecent(
  set: typeof useAgentStore.setState,
  walletAddress: string,
  threadId: string,
) {
  const all = readRecents();
  const recent = (all[walletAddress] ?? []).filter(
    (item) => item.id !== threadId,
  );
  all[walletAddress] = recent;
  writeRecents(all);
  set({ recentThreads: recent });
}

function makeTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 46 ? `${normalized.slice(0, 45)}…` : normalized;
}

function readRecents(): Record<string, AgentRecentThread[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(
      window.localStorage.getItem(RECENTS_KEY) ?? "{}",
    ) as Record<string, AgentRecentThread[]>;
  } catch {
    return {};
  }
}

function writeRecents(value: Record<string, AgentRecentThread[]>) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(value));
  }
}

function panelPreferenceKey(walletAddress?: string) {
  return walletAddress ?? "disconnected";
}

function readPanelPreference(
  walletAddress?: string,
): { open: boolean } | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(PANEL_KEY);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as
      { open: boolean } | Record<string, { open: boolean }>;
    const legacyOpen = (parsed as { open?: unknown }).open;
    if (typeof legacyOpen === "boolean") {
      return { open: legacyOpen };
    }
    return (parsed as Record<string, { open: boolean }>)[
      panelPreferenceKey(walletAddress)
    ];
  } catch {
    return undefined;
  }
}

function writePanelPreference(
  walletAddress: string | undefined,
  open: boolean,
) {
  if (typeof window === "undefined") return;
  let current: Record<string, { open: boolean }> = {};
  try {
    const value = window.localStorage.getItem(PANEL_KEY);
    if (value) {
      const parsed = JSON.parse(value) as
        { open: boolean } | Record<string, { open: boolean }>;
      if (typeof (parsed as { open?: unknown }).open !== "boolean") {
        current = parsed as Record<string, { open: boolean }>;
      }
    }
  } catch {
    current = {};
  }
  current[panelPreferenceKey(walletAddress)] = { open };
  window.localStorage.setItem(PANEL_KEY, JSON.stringify(current));
}
