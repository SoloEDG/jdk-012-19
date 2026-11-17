import type { GalleryDocument, TourRecord } from "../../../shared/types";
import { artworkById, routes } from "../../../shared/catalog";

export function recapStats(d: GalleryDocument) {
  const tourDwellIds = new Set(
    d.tours.flatMap((t) =>
      Object.entries(t.dwell)
        .filter(([, ms]) => ms > 0)
        .map(([id]) => id),
    ),
  );
  const seenIds = new Set(
    d.visits.filter((v) => v.seconds >= 2).map((v) => v.id),
  );
  for (const id of tourDwellIds) seenIds.add(id);
  const seconds = Math.round(
    [
      // Real observed time, with tour dwell taking precedence when it is the
      // larger of the two records for that work.
      ...new Set([
        ...d.visits.map((v) => v.id),
        ...tourDwellIds,
      ]),
    ].reduce((n, id) => n + realDwellSeconds(d, id), 0),
  );
  return {
    seen: seenIds.size,
    seconds,
    saved: d.favorites.length,
  };
}
/** Real dwell for an artwork across every tour visit, in seconds. */
export function tourDwellSeconds(d: GalleryDocument, id: string): number {
  return Math.round(
    d.tours.reduce((ms, t) => ms + (t.dwell[id] || 0), 0) / 1000,
  );
}
/**
 * Dwell that is actually defensible for a work: time recorded standing near
 * it, plus tour dwell when the tour ran longer than the free-roam record.
 * Always real elapsed time — never the planned narration duration.
 */
export function realDwellSeconds(d: GalleryDocument, id: string): number {
  const visited = Math.round(d.visits.find((v) => v.id === id)?.seconds || 0);
  return Math.max(visited, tourDwellSeconds(d, id));
}
export type TourSummary = {
  record: TourRecord;
  name: string;
  stops: number;
  dwellSeconds: number;
  plannedSeconds: number;
  actualSeconds: number;
  overrunSeconds: number;
};
export function tourSummaries(d: GalleryDocument): TourSummary[] {
  return d.tours.map((record) => {
    const route = routes.find((r) => r.id === record.routeId);
    const dwellSeconds = Math.round(
      Object.values(record.dwell).reduce((n, ms) => n + ms, 0) / 1000,
    );
    const actualSeconds = Math.max(
      0,
      Math.round((record.endedAt - record.startedAt) / 1000),
    );
    return {
      record,
      name: route?.name || record.routeId,
      stops: record.confirmedStops.length,
      dwellSeconds,
      plannedSeconds: Math.round(record.plannedMs / 1000),
      actualSeconds,
      overrunSeconds: Math.max(0, actualSeconds - Math.round(record.plannedMs / 1000)),
    };
  });
}
export function createRecap(d: GalleryDocument): string {
  const stats = recapStats(d);
  const tours = tourSummaries(d);
  return [
    "余境 · 我的参观回顾",
    `观看 ${stats.seen} 件作品 · 停留 ${stats.seconds} 秒`,
    "",
    ...d.favorites.map((id) => {
      const a = artworkById(id);
      return a
        ? `${a.title} / ${a.artist}
${d.notes[id] || "未添加感想"}
实际停留 ${realDwellSeconds(d, id)} 秒${
          tourDwellSeconds(d, id) > 0
            ? `（其中导览停留 ${tourDwellSeconds(d, id)} 秒）`
            : ""
        }`
        : "";
    }),
    ...(tours.length
      ? [
          "",
          "导览记录",
          ...tours.map(
            (t) =>
              `${t.name} · ${t.record.completed ? "完成" : "中途结束"} ${t.stops} 站
原计划 ${t.plannedSeconds} 秒 · 实际 ${t.actualSeconds} 秒${
                t.overrunSeconds > 0
                  ? `（比计划多停留 ${t.overrunSeconds} 秒）`
                  : ""
              }
作品前实际停留 ${t.dwellSeconds} 秒`,
          ),
        ]
      : []),
  ].join("\n\n");
}
