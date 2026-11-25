import { invoke, isTauri } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

// Mirrors src-tauri/src/workspace/timelines.rs (09).

export type ViewMode = "episode" | "story" | "both";
export const VIEW_MODES: ViewMode[] = ["episode", "story", "both"];
export type Certainty = "confirmed" | "estimated" | "unknown";
export const CERTAINTIES: Certainty[] = ["confirmed", "estimated", "unknown"];
export type EventReview = "noEpisode" | "noRevision" | "unreviewed" | "reviewed" | "recheck";

export interface StoryTrack {
  trackId: string;
  label: string;
}

export interface Collection {
  schemaVersion: number;
  collectionId: string;
  name: string;
  defaultMode: ViewMode;
  createdAt: string;
  eventCount: number;
  hash: string;
}

export interface EventInfo {
  eventId: string;
  collectionIds: string[];
  title: string;
  detail: string;
  tagIds: string[];
  relatedCardIds: string[];
  episodeId?: string | null;
  episodeOrder?: number | null;
  storyCertainty?: Certainty | null;
  storyTrackId?: string | null;
  storyOrder?: number | null;
  storyLabel?: string | null;
  reviewedRevisionId?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  /** Effective certainty (older files without the field are derived). */
  certainty: Certainty;
  episodeNumber: number | null;
  review: EventReview;
  reviewedOrdinal: number | null;
  latestRevisionId: string | null;
  latestOrdinal: number | null;
  hash: string;
}

export interface TimelineData {
  collections: Collection[];
  events: EventInfo[];
  tracks: StoryTrack[];
  tracksHash: string;
  problems: { path: string; detail: string }[];
}

export interface EventDraft {
  collectionIds: string[];
  title: string;
  detail: string;
  tagIds: string[];
  relatedCardIds: string[];
  episodeId: string | null;
  episodeOrder: number | null;
  storyCertainty: Certainty;
  storyTrackId: string | null;
  storyOrder: number | null;
  storyLabel: string | null;
}

export interface SaveEventRequest {
  sessionId: string;
  requestId: string;
  eventId: string | null;
  expectedHash: string | null;
  draft: EventDraft;
}

export interface TimelineBackend {
  load(sessionId: string): Promise<TimelineData>;
  createTimeline(sessionId: string, requestId: string, name: string, defaultMode: ViewMode): Promise<Collection>;
  updateTimeline(sessionId: string, requestId: string, collectionId: string, name: string, defaultMode: ViewMode, expectedHash: string): Promise<void>;
  saveEvent(req: SaveEventRequest): Promise<EventInfo>;
  confirmEvent(sessionId: string, requestId: string, eventId: string, revisionId: string): Promise<EventInfo>;
  addTrack(sessionId: string, requestId: string, label: string, expectedHash: string): Promise<StoryTrack[]>;
  renameTrack(sessionId: string, requestId: string, trackId: string, label: string, expectedHash: string): Promise<StoryTrack[]>;
}

const desktop: TimelineBackend = {
  load: (sessionId) => invoke("load_timelines", { sessionId }),
  createTimeline: (sessionId, requestId, name, defaultMode) => invoke("create_timeline", { sessionId, requestId, name, defaultMode }),
  updateTimeline: (sessionId, requestId, collectionId, name, defaultMode, expectedHash) =>
    invoke("update_timeline", { sessionId, requestId, collectionId, name, defaultMode, expectedHash }),
  saveEvent: (request) => invoke("save_event", { request }),
  confirmEvent: (sessionId, requestId, eventId, revisionId) => invoke("confirm_event", { sessionId, requestId, eventId, revisionId }),
  addTrack: (sessionId, requestId, label, expectedHash) => invoke("add_story_track", { sessionId, requestId, label, expectedHash }),
  renameTrack: (sessionId, requestId, trackId, label, expectedHash) =>
    invoke("rename_story_track", { sessionId, requestId, trackId, label, expectedHash }),
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" };
};

export const browserTimelineBackend: TimelineBackend = {
  load: async () => ({ collections: [], events: [], tracks: [], tracksHash: "", problems: [] }),
  createTimeline: unsupported,
  updateTimeline: unsupported,
  saveEvent: unsupported,
  confirmEvent: unsupported,
  addTrack: unsupported,
  renameTrack: unsupported,
};

export function defaultTimelineBackend(): TimelineBackend {
  return isTauri() ? desktop : browserTimelineBackend;
}

export const TimelineBackendCtx = createContext<TimelineBackend>(browserTimelineBackend);
export const useTimelineBackend = () => useContext(TimelineBackendCtx);

/** Same rules as timelines.rs `validate` (S09.B). Returns the reason key or null. */
export function draftProblem(d: EventDraft): string | null {
  if (!d.title.trim()) return "titleEmpty";
  if (d.collectionIds.length === 0) return "noTimeline";
  const story = d.storyCertainty !== "unknown";
  if (story && (!d.storyTrackId || d.storyOrder === null || !Number.isFinite(d.storyOrder))) return "storyIncomplete";
  if (!d.episodeId && !story) return "noCoordinate";
  if (d.episodeOrder !== null && !Number.isFinite(d.episodeOrder)) return "episodeOrder";
  return null;
}

export function hasStory(e: EventInfo): boolean {
  return e.certainty !== "unknown" && !!e.storyTrackId && typeof e.storyOrder === "number";
}

/** Stable orders: equal coordinates fall back to the event ID. */
export function byEpisode(a: EventInfo, b: EventInfo): number {
  const ka = [a.episodeNumber ?? Infinity, a.episodeOrder ?? Infinity];
  const kb = [b.episodeNumber ?? Infinity, b.episodeOrder ?? Infinity];
  return ka[0] - kb[0] || ka[1] - kb[1] || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);
}

export function byStory(tracks: StoryTrack[]) {
  const idx = (e: EventInfo) => (hasStory(e) ? tracks.findIndex((t) => t.trackId === e.storyTrackId) : -1);
  return (a: EventInfo, b: EventInfo): number => {
    const ta = idx(a) < 0 ? Infinity : idx(a);
    const tb = idx(b) < 0 ? Infinity : idx(b);
    const oa = hasStory(a) ? (a.storyOrder as number) : Infinity;
    const ob = hasStory(b) ? (b.storyOrder as number) : Infinity;
    return ta - tb || oa - ob || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);
  };
}
