import { invoke, isTauri } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

// Mirrors src-tauri/src/workspace/lore.rs (08).

export const TEMPLATE_IDS = ["character", "personality", "place", "group", "rule", "note"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const TOP_FOLDERS = ["characters", "places", "groups", "notes"] as const;

export const DEFAULT_FOLDER: Record<TemplateId, string> = {
  character: "characters",
  personality: "characters",
  place: "places",
  group: "groups",
  rule: "notes",
  note: "notes",
};

export interface CardInfo {
  cardId: string;
  templateId: TemplateId;
  name: string;
  aliases: string[];
  tagIds: string[];
  /** Actual folder, e.g. `characters/주연`. */
  folder: string;
  createdAt: string;
  dir: string;
}

export interface FolderInfo {
  path: string;
  count: number;
}

export interface CardList {
  cards: CardInfo[];
  folders: FolderInfo[];
  problems: { dir: string; detail: string }[];
}

export interface CardDoc {
  card: CardInfo;
  body: string;
  bodyHash: string | null;
  metaHash: string;
}

export interface TagInfo {
  tagId: string;
  label: string;
  cardCount: number;
}

export interface MetaPatch {
  name?: string;
  aliases?: string[];
  tagIds?: string[];
}

export interface CreateCardRequest {
  sessionId: string;
  requestId: string;
  templateId: TemplateId;
  name: string;
  folder: string | null;
  body: string;
}

export interface WorldBackend {
  list(sessionId: string): Promise<CardList>;
  read(sessionId: string, cardId: string): Promise<CardDoc>;
  create(req: CreateCardRequest): Promise<CardInfo>;
  saveBody(sessionId: string, requestId: string, cardId: string, text: string, expectedHash: string | null): Promise<CardDoc>;
  updateMeta(sessionId: string, requestId: string, cardId: string, patch: MetaPatch, expectedMetaHash: string): Promise<CardDoc>;
  move(sessionId: string, requestId: string, cardId: string, folder: string): Promise<CardDoc>;
  createFolder(sessionId: string, folder: string): Promise<string>;
  listTags(sessionId: string): Promise<TagInfo[]>;
  createTag(sessionId: string, requestId: string, label: string): Promise<TagInfo>;
  renameTag(sessionId: string, requestId: string, tagId: string, label: string): Promise<TagInfo>;
  deleteTagEverywhere(sessionId: string, requestId: string, tagId: string): Promise<number>;
}

const desktop: WorldBackend = {
  list: (sessionId) => invoke("list_cards", { sessionId }),
  read: (sessionId, cardId) => invoke("read_card", { sessionId, cardId }),
  create: (request) => invoke("create_card", { request }),
  saveBody: (sessionId, requestId, cardId, text, expectedHash) =>
    invoke("save_card_body", { sessionId, requestId, cardId, text, expectedHash }),
  updateMeta: (sessionId, requestId, cardId, patch, expectedMetaHash) =>
    invoke("update_card_meta", { sessionId, requestId, cardId, patch, expectedMetaHash }),
  move: (sessionId, requestId, cardId, folder) => invoke("move_card", { sessionId, requestId, cardId, folder }),
  createFolder: (sessionId, folder) => invoke("create_card_folder", { sessionId, folder }),
  listTags: (sessionId) => invoke("list_tags", { sessionId }),
  createTag: (sessionId, requestId, label) => invoke("create_tag", { sessionId, requestId, label }),
  renameTag: (sessionId, requestId, tagId, label) => invoke("rename_tag", { sessionId, requestId, tagId, label }),
  deleteTagEverywhere: (sessionId, requestId, tagId) => invoke("delete_tag_everywhere", { sessionId, requestId, tagId }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserWorldBackend: WorldBackend = {
  list: async () => ({ cards: [], folders: [], problems: [] }),
  read: unsupported,
  create: unsupported,
  saveBody: unsupported,
  updateMeta: unsupported,
  move: unsupported,
  createFolder: unsupported,
  listTags: async () => [],
  createTag: unsupported,
  renameTag: unsupported,
  deleteTagEverywhere: unsupported,
};

export function defaultWorldBackend(): WorldBackend {
  return isTauri() ? desktop : browserWorldBackend;
}

export const WorldBackendCtx = createContext<WorldBackend>(browserWorldBackend);
export const useWorldBackend = () => useContext(WorldBackendCtx);

/** "Hide in view" is a per-work view preference only; it never touches card data. */
export interface HiddenTagStore {
  load(workspaceId: string): string[];
  save(workspaceId: string, tagIds: string[]): void;
}

export const localHiddenTagStore: HiddenTagStore = {
  load(workspaceId) {
    try {
      const v = JSON.parse(localStorage.getItem(`galpi.world.hiddenTags.${workspaceId}`) ?? "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  },
  save(workspaceId, tagIds) {
    try {
      localStorage.setItem(`galpi.world.hiddenTags.${workspaceId}`, JSON.stringify(tagIds));
    } catch {
      /* view preference only */
    }
  },
};

/** ‘현재 전체 설정 열기’ (10): an explicit request from another root to open a card. */
let pendingCard: string | null = null;
export const OPEN_CARD_EVENT = "galpi:open-card";
export function requestOpenCard(cardId: string) {
  pendingCard = cardId;
  window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: cardId }));
}
export function takePendingCard(): string | null {
  const c = pendingCard;
  pendingCard = null;
  return c;
}
