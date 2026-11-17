import { useReducer } from "react";
import { tourTarget, tourRoute } from "../lib/routeProgress";
import {
  initialTourState,
  isTourActive,
  tourReducer,
} from "../lib/tourMachine";

export { isTourActive } from "../lib/tourMachine";

export function useTour() {
  const [state, dispatch] = useReducer(tourReducer, initialTourState);
  return {
    state,
    target: tourTarget(state),
    route: tourRoute(state),
    active: isTourActive(state),
    start: (id: string) =>
      dispatch({ type: "start", routeId: id, now: Date.now() }),
    /**
     * Add real time to the current stop. Called by a 1s clock only while the
     * visitor is actually present, so pauses and walking don't inflate it.
     */
    addDwell: (ms: number) => dispatch({ type: "dwell", ms }),
    /** Keep the saved narration position current while listening. */
    syncElapsed: (elapsed: number) =>
      dispatch({ type: "syncElapsed", elapsed }),
    /**
     * Automatic events carry the intent token they were created for. If the
     * route has already moved on (new stop, left, restarted), the event is
     * stale and must not move the current stop.
     */
    arrive: (intent: number) => dispatch({ type: "arrive", intent }),
    /** The visitor is looking at the work — the "关注" stage. */
    attend: (intent: number) => dispatch({ type: "attend", intent }),
    /** Narration of the current stop actually starts. */
    listen: (intent: number) => dispatch({ type: "listen", intent }),
    /** Narration finished: keep the visitor at the stop until they say so. */
    complete: (intent: number, elapsed: number) =>
      dispatch({ type: "complete", intent, elapsed }),
    /**
     * The visitor chose to walk away. The stop is kept, with the narration
     * position they stopped at, so returning can continue from there.
     * Bumping the intent invalidates any in-flight events from this stop.
     */
    leave: (elapsed?: number, completed?: boolean) =>
      dispatch({ type: "leave", elapsed, completed }),
    /**
     * Walk back to the stop the visitor is at / left. Keeps what they had
     * already heard, so the narration continues instead of restarting.
     */
    rejoin: () => dispatch({ type: "rejoin" }),
    /** Deliberately replay this stop's narration from the beginning. */
    replay: (intent: number) => dispatch({ type: "replay", intent }),
    /**
     * Explicit confirmation that the visitor is done with the current stop.
     * This is the only thing that advances route progress.
     */
    confirmNext: (elapsed?: number) =>
      dispatch({ type: "confirm", elapsed, now: Date.now() }),
    pause: (elapsed?: number) => dispatch({ type: "pause", elapsed }),
    resume: () => dispatch({ type: "resume" }),
    /**
     * The visitor accepts that the visit runs past the original estimate.
     * The delay at decision time is kept so a later, bigger slip can be
     * surfaced again instead of silently accumulating.
     */
    extend: (delayMs = 0) => dispatch({ type: "extend", delayMs }),
    /**
     * Keep the planned finish by trimming what is left — the narration that is
     * currently playing is never cut, only later stops are played faster.
     */
    tighten: (delayMs = 0) => dispatch({ type: "tighten", delayMs }),
    stop: () => dispatch({ type: "stop" }),
  };
}
