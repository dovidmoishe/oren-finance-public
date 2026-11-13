import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const nodeRequire = createRequire(new URL("../package.json", import.meta.url));

function transpile(path) {
  return ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function loadStore(getAgentThreadMessages) {
  const storage = new Map();
  const walletSession = {};
  vm.runInNewContext(transpile("../services/wallet-session.ts"), {
    exports: walletSession,
  });
  const exports = {};
  vm.runInNewContext(transpile("../store/agent-store.ts"), {
    exports,
    window: {
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, value),
      },
      matchMedia: () => ({ matches: false }),
    },
    require(id) {
      if (id === "zustand") return nodeRequire("zustand");
      if (id === "@/services/wallet-session") return walletSession;
      if (id === "@/services") {
        return {
          ApiError,
          getAgentThreadMessages,
          streamAgentMessage: async () => {},
        };
      }
      throw new Error(`unexpected import ${id}`);
    },
  });
  return { useAgentStore: exports.useAgentStore, storage };
}

function seedRecent(storage, wallet, threadId) {
  storage.set(
    "oren-agent-recents-v1",
    JSON.stringify({
      [wallet]: [
        { id: threadId, title: "NVDA", updatedAt: "2026-11-08T00:00:00.000Z" },
      ],
    }),
  );
}

test("a 401 while restoring history keeps the saved thread shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-1";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new ApiError("Authentication required", 401);
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(
    saved[wallet].map((item) => item.id),
    [threadId],
  );
  assert.deepEqual(
    Array.from(useAgentStore.getState().recentThreads, (item) => item.id),
    [threadId],
  );
  assert.ok(useAgentStore.getState().error);
});

test("a transport failure while restoring history keeps the saved thread shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-1";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new Error("network down");
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(
    saved[wallet].map((item) => item.id),
    [threadId],
  );
});

test("a missing thread still drops the saved shortcut", async () => {
  const wallet = "wallet-1";
  const threadId = "thread-gone";
  const { useAgentStore, storage } = loadStore(async () => {
    throw new ApiError("threadId not found", 400);
  });
  seedRecent(storage, wallet, threadId);

  await useAgentStore.getState().initialize(wallet);

  const saved = JSON.parse(storage.get("oren-agent-recents-v1"));
  assert.deepEqual(saved[wallet], []);
});
