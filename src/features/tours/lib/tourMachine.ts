import type { TourPhase, TourState } from "../../../shared/types";
import { routes } from "../../../shared/catalog";
import { plannedRouteMs, tourRoute } from "./routeProgress";

/**
 * Pure transition logic for the guided tour. Kept separate from React so the
 * event-validity rules (stale narration ends, rapid skips, returns) can be
 * verified directly.
 */
export const ACTIVE_PHASES: TourPhase[] = [
  "walking",
  "arrived",
  "attending",
  "listening",
  "awaiting",
  "left",
];
/** Phases in which the visitor is physically standing at the stop. */
export const DWELL_PHASES: TourPhase[] = [
  "arrived",
  "attending",
  "listening",
  "awaiting",
];
/** Phases where the visitor is at the stop and audio may be (re)started. */
export const AT_STOP_PHASES: TourPhase[] = [
  "arrived",
  "attending",
  "listening",
  "awaiting",
];

/**
 * Intent tokens are globally monotonic, so an event from an earlier tour
 * session can never be mistaken for an event of a newly started route.
 */
let intentSequence = 0;
export const nextIntent = () => ++intentSequence;
/** Test-only: keeps token ordering deterministic across cases. */
export const resetIntentSequence = () => {
  intentSequence = 0;
};

export const initialTourState: TourState = {
  routeId: null,
  step: 0,
  phase: "idle",
  paused: false,
  pausedPhase: null,
  intent: 0,
  stopElapsed: 0,
  stopCompleted: false,
  stopDwellMs: 0,
  dwell: {},
  confirmedStops: [],
  extended: false,
  tightened: false,
  choiceDelayMs: null,
  plannedMs: 0,
  startedAt: null,
  arrivedAt: null,
  awaitingAt: null,
  completedAt: null,
};

export const isTourActive = (t: TourState) => ACTIVE_PHASES.includes(t.phase);

export type TourAction =
  | { type: "start"; routeId: string; now: number }
  | { type: "dwell"; ms: number }
  | { type: "syncElapsed"; elapsed: number }
  | { type: "arrive"; intent: number }
  | { type: "attend"; intent: number }
  | { type: "listen"; intent: number }
  | { type: "complete"; intent: number; elapsed: number; now?: number }
  | { type: "replay"; intent: number }
  | { type: "leave"; elapsed?: number; completed?: boolean }
  | { type: "rejoin" }
  | { type: "confirm"; elapsed?: number; now?: number }
  | { type: "pause"; elapsed?: number }
  | { type: "resume" }
  | { type: "extend"; delayMs: number }
  | { type: "tighten"; delayMs: number }
  | { type: "stop" };

export function tourReducer(t: TourState, action: TourAction): TourState {
  switch (action.type) {
    case "start": {
      const route = routes.find((r) => r.id === action.routeId);
      if (!route) return t;
      return {
        ...initialTourState,
        routeId: action.routeId,
        phase: "walking",
        intent: nextIntent(),
        plannedMs: plannedRouteMs(route),
        startedAt: action.now,
      };
    }
    case "dwell":
      return DWELL_PHASES.includes(t.phase) && !t.paused
        ? { ...t, stopDwellMs: t.stopDwellMs + action.ms }
        : t;
    case "syncElapsed":
      // Only track progress while actually listening to this stop's audio.
      return t.phase === "listening" && !t.paused
        ? { ...t, stopElapsed: action.elapsed }
        : t;
    case "arrive":
      return t.intent === action.intent && t.phase === "walking" && !t.paused
        ? { ...t, phase: "arrived", arrivedAt: Date.now() }
        : t;
    case "attend":
      return t.intent === action.intent && t.phase === "arrived" && !t.paused
        ? { ...t, phase: "attending" }
        : t;
    case "listen":
      return t.intent === action.intent &&
        !t.paused &&
        AT_STOP_PHASES.includes(t.phase)
        ? { ...t, phase: "listening", awaitingAt: null }
        : t;
    case "complete":
      return t.intent === action.intent &&
        t.phase === "listening" &&
        !t.paused
        ? {
            ...t,
            phase: "awaiting",
            stopCompleted: true,
            stopElapsed: action.elapsed,
            awaitingAt: action.now ?? Date.now(),
          }
        : t;
    case "leave": {
      if (!ACTIVE_PHASES.includes(t.phase) || t.phase === "left") return t;
      // A paused tour stays paused: wandering off while paused doesn't turn the
      // pause into a departure. Only a running tour is marked as left.
      if (t.paused) {
        return { ...t, stopElapsed: action.elapsed ?? t.stopElapsed };
      }
      // If the narration had already reached its end, the stop is complete no
      // matter which stage the visitor left from — otherwise "awaiting" would
      // be lost just because they left a moment later.
      const stopCompleted = t.stopCompleted || action.completed === true;
      return {
        ...t,
        phase: "left",
        intent: nextIntent(),
        stopCompleted,
        stopElapsed: action.elapsed ?? t.stopElapsed,
        arrivedAt: null,
        awaitingAt: null,
      };
    }
    case "replay":
      // Only a stop the tour is currently sitting on may be replayed, and the
      // narration starts from the beginning under the same stop intent, so its
      // end still belongs to this stop.
      return t.intent === action.intent &&
        AT_STOP_PHASES.includes(t.phase) &&
        !t.paused
        ? {
            ...t,
            phase: "listening",
            stopCompleted: false,
            stopElapsed: 0,
            awaitingAt: null,
          }
        : t;
    case "rejoin":
      return ACTIVE_PHASES.includes(t.phase)
        ? {
            ...t,
            phase: "walking",
            intent: nextIntent(),
            paused: false,
            pausedPhase: null,
            arrivedAt: null,
            awaitingAt: null,
          }
        : t;
    case "confirm": {
      const r = tourRoute(t);
      if (!r || t.phase === "idle" || t.phase === "done") return t;
      const current = r.stops[t.step];
      if (!current) return t;
      const confirmedStops = t.confirmedStops.includes(current)
        ? t.confirmedStops
        : [...t.confirmedStops, current];
      // Persist the real time actually spent here, so a longer look is kept in
      // the recap as dwell — never replaced by the planned narration length.
      const dwell = {
        ...t.dwell,
        [current]: Math.max(t.dwell[current] || 0, t.stopDwellMs),
      };
      const stopElapsed = action.elapsed ?? t.stopElapsed;
      const now = action.now ?? Date.now();
      if (t.step + 1 >= r.stops.length) {
        return {
          ...t,
          dwell,
          confirmedStops,
          phase: "done",
          paused: false,
          pausedPhase: null,
          stopElapsed,
          awaitingAt: null,
          completedAt: now,
        };
      }
      return {
        ...t,
        step: t.step + 1,
        phase: "walking",
        intent: nextIntent(),
        paused: false,
        pausedPhase: null,
        dwell,
        stopElapsed: 0,
        stopCompleted: false,
        stopDwellMs: 0,
        arrivedAt: null,
        awaitingAt: null,
        confirmedStops,
      };
    }
    case "pause":
      return t.paused || !isTourActive(t)
        ? t
        : {
            ...t,
            paused: true,
            pausedPhase: t.phase as TourState["pausedPhase"],
            stopElapsed: action.elapsed ?? t.stopElapsed,
          };
    case "resume":
      return t.paused ? { ...t, paused: false, pausedPhase: null } : t;
    case "extend":
      return { ...t, extended: true, tightened: false, choiceDelayMs: action.delayMs };
    case "tighten":
      return { ...t, tightened: true, extended: false, choiceDelayMs: action.delayMs };
    case "stop":
      return initialTourState;
    default:
      return t;
  }
}
