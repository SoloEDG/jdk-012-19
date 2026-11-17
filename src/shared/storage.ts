import type { GalleryDocument, TourRecord } from "./types";
const key = "yujing-gallery-v1";
export const emptyDocument = (): GalleryDocument => ({
  favorites: [],
  visits: [],
  notes: {},
  tours: [],
});
const isTourRecord = (v: unknown): v is TourRecord => {
  if (!v || typeof v !== "object") return false;
  const r = v as Partial<TourRecord>;
  return (
    typeof r.routeId === "string" &&
    typeof r.startedAt === "number" &&
    typeof r.endedAt === "number" &&
    typeof r.plannedMs === "number" &&
    !!r.dwell &&
    typeof r.dwell === "object" &&
    Array.isArray(r.confirmedStops) &&
    typeof r.completed === "boolean"
  );
};
export function loadDocument(): GalleryDocument {
  try {
    const d = JSON.parse(localStorage.getItem(key) || "null");
    if (!d) return emptyDocument();
    return {
      favorites: Array.isArray(d.favorites)
        ? d.favorites.filter((v: unknown) => typeof v === "string")
        : [],
      visits: Array.isArray(d.visits)
        ? d.visits.filter(
            (v: { id?: unknown; seconds?: unknown }) =>
              typeof v.id === "string" && typeof v.seconds === "number",
          )
        : [],
      notes: typeof d.notes === "object" && d.notes ? d.notes : {},
      tours: Array.isArray(d.tours) ? d.tours.filter(isTourRecord) : [],
    };
  } catch {
    return emptyDocument();
  }
}
export function saveDocument(d: GalleryDocument): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}
