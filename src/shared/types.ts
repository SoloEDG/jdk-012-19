export type Point = { x: number; z: number };
export type Artwork = {
  id: string;
  title: string;
  en: string;
  artist: string;
  year: string;
  medium: string;
  color: string;
  position: Point;
  facing: number;
  description: string;
  transcript: string[];
  duration: number;
};
export type Route = {
  id: string;
  name: string;
  subtitle: string;
  stops: string[];
};
export type Visit = { id: string; seconds: number; at: number };
/** A completed (or abandoned) tour, stored with what really happened. */
export type TourRecord = {
  routeId: string;
  startedAt: number;
  endedAt: number;
  /** Original planned duration at 1x, kept only for comparison. */
  plannedMs: number;
  /** Real dwell per stop id — extended waits included, walks excluded. */
  dwell: Record<string, number>;
  /** Stops the visitor explicitly confirmed leaving. */
  confirmedStops: string[];
  completed: boolean;
};
export type GalleryDocument = {
  favorites: string[];
  visits: Visit[];
  notes: Record<string, string>;
  tours: TourRecord[];
};
/**
 * A route stop moves through explicit, user-facing stages:
 * walking -> arrived (抵达) -> attending (关注) -> listening (听讲)
 * -> awaiting (讲解结束，等待用户确认离开) -> next stop / done.
 * `left` means the visitor actively walked away; the stop is retained so
 * they can come back and continue where they stopped.
 */
export type TourPhase =
  | "idle"
  | "walking"
  | "arrived"
  | "attending"
  | "listening"
  | "awaiting"
  | "left"
  | "done";
export type TourState = {
  routeId: string | null;
  /** Current stop index. It only advances after an explicit user confirmation. */
  step: number;
  phase: TourPhase;
  /** Pausing keeps the phase; `pausedPhase` is the phase to resume into. */
  paused: boolean;
  pausedPhase: Exclude<TourPhase, "idle" | "done"> | null;
  /**
   * Monotonic intent token. Every spatial/narration event carries the token
   * it was created for; events from an older stop are ignored.
   */
  intent: number;
  /** Narrator position saved when the visitor pauses or walks away (seconds). */
  stopElapsed: number;
  /** Whether the current stop's narration has reached its end. */
  stopCompleted: boolean;
  /** Real time spent at the current stop (arrival to now, minus pauses). */
  stopDwellMs: number;
  /** Real dwell per stop already confirmed, keyed by artwork id (ms). */
  dwell: Record<string, number>;
  /** Stops the visitor explicitly confirmed leaving. Drives route progress. */
  confirmedStops: string[];
  /** Whether the visitor explicitly accepted a longer visit than originally planned. */
  extended: boolean;
  /** The visitor chose to trim the remaining dwell so the route stays on schedule. */
  tightened: boolean;
  /** Delay (ms) at the moment the visitor last made a pace choice. */
  choiceDelayMs: number | null;
  /** Planned route duration in ms (narration at 1x + walking), fixed at start. */
  plannedMs: number;
  startedAt: number | null;
  arrivedAt: number | null;
  awaitingAt: number | null;
  completedAt: number | null;
};
export type AudioState = {
  artworkId: string | null;
  elapsed: number;
  playing: boolean;
  rate: number;
  /** True once this narration reached its end (until it is restarted). */
  completed: boolean;
  /** Tour intent this playback belongs to; null for free/manual listening. */
  intent: number | null;
  origin: "tour" | "manual" | null;
};
/** Emitted when a narration reaches its end. Events carry their origin token. */
export type NarrationEnd = {
  artworkId: string;
  intent: number | null;
  origin: "tour" | "manual" | null;
  elapsed: number;
};
export type Command =
  { type: "focus"; id: string } | { type: "favorite"; id: string };
