import { routes, artworkById } from "../../../shared/catalog";
import type { Route, TourState } from "../../../shared/types";

/** A rough walking allowance per stop, used only for planning / ETA. */
export const WALK_MS = 12_000;
/** Small buffer kept for getting settled at each stop. */
export const ROUTE_BUFFER_MS = 15_000;
/** How late a route may run before we surface the explicit pace choice. */
export const EXTENSION_NOTICE_MS = 30_000;
/** Playback speed applied to *later* stops when the visitor chooses to keep time. */
export const CATCHUP_RATE = 1.25;

export function tourRoute(t: TourState): Route | undefined {
  return routes.find((r) => r.id === t.routeId);
}
export function tourTarget(t: TourState): string | null {
  return tourRoute(t)?.stops[t.step] || null;
}
/**
 * Completion is driven by stops the visitor explicitly confirmed leaving,
 * never by narration merely reaching its end.
 */
export function tourProgress(t: TourState): number {
  const r = tourRoute(t);
  if (!r || !r.stops.length) return 0;
  // A finished route is complete even if the last stop's confirmation was
  // interrupted — otherwise the bar could never reach the end.
  if (t.phase === "done") return 1;
  const confirmed = r.stops.filter((id) => t.confirmedStops.includes(id));
  return confirmed.length / r.stops.length;
}
export function plannedRouteMs(route: Route): number {
  return (
    route.stops.reduce(
      (sum, id) => sum + (artworkById(id)?.duration || 0) * 1000,
      0,
    ) +
    route.stops.length * WALK_MS +
    ROUTE_BUFFER_MS
  );
}
/** Remaining planned time from the current stop onwards. */
export function remainingEstimateMs(
  t: TourState,
  currentElapsedSec?: number | null,
  speed = 1,
): number {
  const r = tourRoute(t);
  if (!r || t.phase === "done" || t.phase === "idle") return 0;
  // Trimming only speeds up what has not started yet. The narration the
  // visitor is currently hearing is never cut short or rushed.
  const factor = Math.max(1, speed);
  let ms = 0;
  for (let i = t.step; i < r.stops.length; i++) {
    const durationMs = (artworkById(r.stops[i])?.duration || 0) * 1000;
    if (i === t.step) {
      if (!t.stopCompleted) {
        const positionMs =
          t.phase === "listening" && currentElapsedSec != null
            ? currentElapsedSec * 1000
            : t.stopElapsed;
        ms += Math.max(0, durationMs - Math.max(0, positionMs));
      }
    } else {
      ms += durationMs / factor;
    }
    ms += WALK_MS;
  }
  return ms;
}
export type TourTiming = {
  plannedFinishAt: number | null;
  projectedFinishAt: number | null;
  /** Positive when the current pace runs later than the original plan. */
  delayMs: number;
  remainingMs: number;
};
/**
 * ETA from the visitor's current pace. Waiting longer at a stop keeps
 * pushing the projection forward, so the consequence of an extended visit
 * stays visible instead of being hidden behind a fixed estimate.
 */
export function tourTiming(
  t: TourState,
  now: number,
  currentElapsedSec?: number | null,
): TourTiming {
  // Once the visitor chooses to keep the planned finish, later narration runs
  // slightly faster — the ETA must reflect that, not pretend nothing changed.
  const speed = t.tightened ? CATCHUP_RATE : 1;
  const remainingMs = remainingEstimateMs(t, currentElapsedSec, speed);
  const plannedFinishAt =
    t.startedAt != null ? t.startedAt + t.plannedMs : null;
  if (t.phase === "idle" || !t.routeId) {
    return { plannedFinishAt, projectedFinishAt: null, delayMs: 0, remainingMs };
  }
  if (t.phase === "done") {
    return {
      plannedFinishAt,
      projectedFinishAt: t.completedAt,
      delayMs:
        t.completedAt != null && plannedFinishAt != null
          ? Math.max(0, t.completedAt - plannedFinishAt)
          : 0,
      remainingMs: 0,
    };
  }
  const projectedFinishAt = now + remainingMs;
  return {
    plannedFinishAt,
    projectedFinishAt,
    delayMs:
      plannedFinishAt != null
        ? Math.max(0, projectedFinishAt - plannedFinishAt)
        : 0,
    remainingMs,
  };
}
export function formatClock(at: number | null): string {
  if (at == null) return "--:--";
  return new Date(at).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
/**
 * A choice is surfaced once the route slips noticeably behind, and again if a
 * "keep the schedule" decision is later overtaken by an even longer visit.
 * Extension is a one-way acceptance: once chosen, we stop interrupting.
 */
export function needsPaceChoice(t: TourState, delayMs: number): boolean {
  if (t.phase === "idle" || t.phase === "done" || t.extended) return false;
  if (delayMs < EXTENSION_NOTICE_MS) return false;
  if (t.choiceDelayMs == null) return true;
  return delayMs >= t.choiceDelayMs + EXTENSION_NOTICE_MS;
}
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟`;
}
export function formatApproxMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `约 ${minutes} 分钟`;
}
