import { useEffect, useRef, useState } from "react";
import { useWalker, distance, viewingPoint } from "../features/space";
import { useCatalog } from "../features/catalog";
import { useNarration } from "../features/narration";
import { useTour } from "../features/tours";
import { CATCHUP_RATE } from "../features/tours/lib/routeProgress";
import { useCollection } from "../features/collection";
import { artworkById } from "../shared/catalog";
import type { NarrationEnd } from "../shared/types";

/** Distance below which the visitor counts as standing at a stop. */
const ARRIVE_RADIUS = 0.15;
/** Walking this far from the stop cancels the guided intent. */
const LEAVE_RADIUS = 3.2;
/** A short look before the narration begins — the "关注" stage. */
const ATTEND_DELAY_MS = 650;

export function useGallery() {
  const catalog = useCatalog();
  const tour = useTour();
  const collection = useCollection();
  const narrationRef = useRef<ReturnType<typeof useNarration> | null>(null);
  const tourRef = useRef(tour);
  tourRef.current = tour;
  const tightenedRef = useRef(tour.state.tightened);
  tightenedRef.current = tour.state.tightened;

  /**
   * Mark the current stop as left, remembering where the narration was and
   * whether it had already finished. Used by every "the visitor chose to go
   * elsewhere" path so they are never pulled back and never lose their place.
   */
  const leaveStop = () => {
    const t = tourRef.current;
    if (!t.active || t.state.paused) return;
    const audio = narrationRef.current?.state;
    t.leave(audio?.elapsed, audio?.completed);
    narrationRef.current?.pause();
  };

  const walker = useWalker(catalog.observe, () => {
    // A real key press means the visitor takes over walking. The tour keeps
    // the stop (and where they stopped hearing it) but stops pulling, so they
    // are never dragged back to a stop they chose to walk away from.
    leaveStop();
  });

  /**
   * Narration ends only advance the stop they were produced for. A stale end
   * (after leaving, skipping, restarting, or listening elsewhere) is ignored,
   * and completion never advances the route by itself — it only opens the
   * "waiting for the visitor to leave" stage.
   */
  const narration = useNarration((event: NarrationEnd) => {
    const t = tourRef.current;
    if (!t.active || !t.target) return;
    if (event.artworkId !== t.target) return;
    if (event.intent == null || event.intent !== t.state.intent) return;
    t.complete(t.state.intent, event.elapsed);
  });
  narrationRef.current = narration;

  const go = (id: string) => {
    const a = artworkById(id);
    if (!a) return;
    catalog.select(id);
    walker.go(viewingPoint(a.position, a.facing));
    walker.yaw.current = a.facing;
  };

  /**
   * Free exploration. If a tour is in progress, choosing another work is the
   * visitor leaving: the stop is retained (with where they stopped listening)
   * rather than dragging them back, and returning later resumes from there.
   */
  const explore = (id: string) => {
    if (tour.active) {
      if (tour.target === id && tour.state.phase === "left") {
        // Explicitly returning to the stop — the only way back, never automatic.
        tour.rejoin();
      } else if (tour.target !== id) {
        leaveStop();
      }
    }
    go(id);
  };

  /**
   * Listening is a spatial decision too: only the stop the tour is currently
   * at may be narrated under the tour's intent. Anything else becomes a
   * free-standing listen and can never advance the route.
   */
  const listen = (id: string) => {
    const inTour = tour.active && tour.target === id;
    if (!inTour) {
      // Listening to something else never drags the tour along; a paused tour
      // simply stays paused and keeps its place.
      if (tour.active) leaveStop();
      narration.play(id, { origin: "manual" });
      return;
    }
    if (tour.state.paused) {
      // Explicitly choosing to hear this stop clears the pause, then the
      // normal resume rules decide whether to walk back or continue audio.
      tour.resume();
    }
    switch (tour.state.phase) {
      case "left":
        // Continue where they stopped: rejoin walks back and resumes.
        tour.rejoin();
        return;
      case "walking":
      case "arrived":
      case "attending":
        // The arrival pipeline will start the narration for this stop.
        return;
      case "awaiting":
        // The visitor asked to hear it again after it finished.
        tour.replay(tour.state.intent);
        narration.play(id, {
          intent: tour.state.intent,
          origin: "tour",
          from: 0,
        });
        return;
      case "listening":
        if (narration.state.playing) narration.pause();
        else
          narration.play(id, {
            intent: tour.state.intent,
            origin: "tour",
            from: tour.state.stopElapsed,
          });
        return;
      default:
        narration.play(id, { origin: "manual" });
    }
  };

  /**
   * The global player's play/pause button. For a work the tour is currently
   * presenting, it goes through the same spatial rules as everything else, so
   * pressing play can never start audio under a stale stop's intent.
   * For anything else it is a plain media control (replaying a finished
   * narration restarts it instead of instantly "ending" again).
   */
  const toggleNarration = () => {
    const id = narration.state.artworkId;
    const artwork = artworkById(id);
    if (!id || !artwork) return;
    if (tour.active && tour.target === id) {
      const phase = tour.state.phase;
      if (phase === "left" || phase === "walking") {
        // Returning to the stop is an explicit re-join, not a remote play.
        listen(id);
        return;
      }
      if (!narration.state.playing && narration.state.elapsed >= artwork.duration) {
        tour.replay(tour.state.intent);
        narration.play(id, {
          intent: tour.state.intent,
          origin: "tour",
          from: 0,
        });
        return;
      }
      if (narration.state.playing) {
        narration.pause();
        tour.pause(narration.state.elapsed);
      } else {
        narration.play(id, {
          intent: tour.state.intent,
          origin: "tour",
          from: tour.state.stopElapsed,
        });
        tour.resume();
      }
      return;
    }
    if (!narration.state.playing && narration.state.elapsed >= artwork.duration) {
      narration.play(id, { origin: "manual", from: 0 });
      return;
    }
    narration.toggle();
  };

  // Only a walking intent actually moves the camera. Every other phase means
  // the visitor is (or may be) at the stop, so navigation is not re-issued.
  useEffect(() => {
    if (tour.state.phase !== "walking" || tour.state.paused || !tour.target)
      return;
    go(tour.target);
  }, [tour.state.phase, tour.state.intent, tour.state.paused, tour.target]);

  // 抵达: close enough, so the automatic walk ends here.
  useEffect(() => {
    if (tour.state.phase !== "walking" || tour.state.paused || !tour.target)
      return;
    const a = artworkById(tour.target);
    if (!a) return;
    if (
      distance(walker.position, viewingPoint(a.position, a.facing)) <
      ARRIVE_RADIUS
    ) {
      walker.stop();
      tour.arrive(tour.state.intent);
    }
  }, [
    walker.position,
    tour.state.phase,
    tour.state.intent,
    tour.state.paused,
    tour.target,
  ]);

  // 抵达 -> 关注. A short look also gives a returning visitor room to settle
  // before the audio picks up where they left it.
  useEffect(() => {
    if (tour.state.phase !== "arrived" || tour.state.paused) return;
    const intent = tour.state.intent;
    const t = setTimeout(() => tour.attend(intent), ATTEND_DELAY_MS);
    return () => clearTimeout(t);
  }, [tour.state.phase, tour.state.intent, tour.state.paused]);

  // 关注 -> 听讲. The narration resumes from the saved position, never from 0,
  // so a visitor who left and came back continues instead of restarting.
  // If they already heard all of it, returning just re-opens the decision.
  useEffect(() => {
    if (tour.state.phase !== "attending" || tour.state.paused || !tour.target)
      return;
    const artwork = artworkById(tour.target);
    const atEnd =
      artwork != null && tour.state.stopElapsed >= artwork.duration - 0.05;
    if (tour.state.stopCompleted || atEnd) {
      // Already heard all of it: re-open the decision instead of replaying.
      tour.listen(tour.state.intent);
      tour.complete(tour.state.intent, artwork?.duration ?? 0);
      return;
    }
    narration.play(tour.target, {
      intent: tour.state.intent,
      origin: "tour",
      from: tour.state.stopElapsed,
      // Trimming only ever applies to narration that has not started yet. The
      // audio the visitor is currently hearing is never cut or sped up.
      rate: tightenedRef.current ? CATCHUP_RATE : 1,
    });
    tour.listen(tour.state.intent);
    // `tightened` is deliberately not a dependency: choosing it must not
    // restart narration that is already underway.
  }, [
    tour.state.phase,
    tour.state.intent,
    tour.state.paused,
    tour.state.stopCompleted,
    tour.state.stopElapsed,
    tour.target,
  ]);

  // While at the stop, the narration is the authority for how far the visitor
  // has listened. Keeping stopElapsed in sync means leaving mid-sentence
  // resumes there and the ETA reflects what is actually left to hear.
  useEffect(() => {
    if (tour.state.phase !== "listening" || tour.state.paused) return;
    if (narration.state.artworkId !== tour.target) return;
    tour.syncElapsed(narration.state.elapsed);
  }, [
    narration.state.elapsed,
    narration.state.artworkId,
    tour.state.phase,
    tour.state.paused,
    tour.target,
  ]);

  // Real dwell clock: seconds only while the visitor is actually standing at
  // the current stop, so pauses, walking and looking at other works never
  // inflate the recap.
  const presenceRef = useRef({ position: walker.position, target: tour.target });
  presenceRef.current = { position: walker.position, target: tour.target };
  useEffect(() => {
    const t = setInterval(() => {
      const { position, target } = presenceRef.current;
      const artwork = artworkById(target);
      if (!artwork) return;
      const atStop =
        distance(position, viewingPoint(artwork.position, artwork.facing)) <=
        LEAVE_RADIUS;
      if (atStop) tour.addDwell(1000);
    }, 1000);
    return () => clearInterval(t);
  }, [tour.state.routeId]);

  // Record real time near a work for the collection recap (not planned time).
  const recordRef = useRef({ nearby: catalog.nearby, record: collection.record });
  recordRef.current = { nearby: catalog.nearby, record: collection.record };
  useEffect(() => {
    const t = setInterval(() => {
      if (recordRef.current.nearby)
        recordRef.current.record(recordRef.current.nearby, 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Walking away from the current stop is the visitor's own choice; the stop
  // stays available but is marked as left rather than pulled back to.
  useEffect(() => {
    if (!tour.active || tour.state.paused || tour.state.phase === "walking")
      return;
    const id = tour.target;
    if (!id) return;
    const a = artworkById(id);
    if (!a) return;
    if (
      distance(walker.position, viewingPoint(a.position, a.facing)) >
      LEAVE_RADIUS
    ) {
      leaveStop();
    }
  }, [
    walker.position,
    tour.state.phase,
    tour.state.paused,
    tour.state.intent,
    tour.target,
  ]);

  // No automatic re-join by proximity: walking near a stop the visitor left
  // does not re-engage navigation or audio. Returning is always an explicit
  // action (回到这一站 / 前往作品 / 收听讲解 / map), so nobody is pulled back.

  /**
   * Persist a finished / abandoned tour with what really happened, so the
   * recap reflects actual dwell rather than the planned narration length.
   */
  const recordedTour = useRef<string | null>(null);
  const recordTourRef = useRef(collection.recordTour);
  recordTourRef.current = collection.recordTour;
  useEffect(() => {
    const t = tour.state;
    if (!t.routeId) return;
    const ended = t.phase === "done";
    if (!ended) return;
    const key = `${t.routeId}:${t.startedAt}`;
    if (recordedTour.current === key) return;
    recordedTour.current = key;
    recordTourRef.current({
      routeId: t.routeId,
      startedAt: t.startedAt ?? Date.now(),
      endedAt: t.completedAt ?? Date.now(),
      plannedMs: t.plannedMs,
      // Real dwell per stop, including time spent past the narration.
      dwell: { ...t.dwell },
      confirmedStops: t.confirmedStops,
      completed: true,
    });
  }, [tour.state]);

  const confirmNext = () => {
    narration.stop();
    tour.confirmNext(narration.state.elapsed);
  };
  const pauseTour = () => {
    narration.pause();
    walker.stop();
    tour.pause(narration.state.elapsed);
  };
  const resumeTour = () => {
    if (!tour.state.paused) return;
    const t = tour.state;
    tour.resume();
    const target = tour.target;
    const artwork = artworkById(target);
    if (!target || !artwork) return;
    // If the visitor wandered off while paused, resuming means walking back to
    // the stop (keeping what they already heard), not narrating from afar.
    const atStop =
      distance(walker.position, viewingPoint(artwork.position, artwork.facing)) <
      LEAVE_RADIUS;
    if (!atStop && t.pausedPhase !== "walking") {
      walker.stop();
      tour.rejoin();
      return;
    }
    if (t.pausedPhase === "walking") {
      // The walk effect only fires on a phase/intent change, so re-issue the
      // destination explicitly after a pause.
      walker.go(viewingPoint(artwork.position, artwork.facing));
      return;
    }
    if (t.phase === "listening" && !t.stopCompleted) {
      narration.play(target, {
        intent: t.intent,
        origin: "tour",
        from: t.stopElapsed,
      });
    }
  };
  /**
   * Keep an abandoned visit honestly: the stops they confirmed and their real
   * dwell are part of the visit even if they never finished the route.
   * A finished route is already recorded by the completion effect above.
   */
  const recordAbandonedTour = () => {
    const t = tour.state;
    if (
      t.phase === "idle" ||
      t.phase === "done" ||
      !t.routeId ||
      !t.startedAt ||
      (!t.confirmedStops.length && t.stopDwellMs <= 0)
    )
      return;
    const dwell = { ...t.dwell };
    const target = tour.target;
    if (target) {
      dwell[target] = Math.max(dwell[target] || 0, t.stopDwellMs);
    }
    recordTourRef.current({
      routeId: t.routeId,
      startedAt: t.startedAt,
      endedAt: Date.now(),
      plannedMs: t.plannedMs,
      dwell,
      confirmedStops: t.confirmedStops,
      completed: false,
    });
  };

  const startTour = (id: string) => {
    // Starting a new journey closes the previous one honestly, and clears any
    // narration that belonged to it — the new tour owns the audio from here.
    recordAbandonedTour();
    narration.stop();
    walker.stop();
    tour.start(id);
  };

  const stopTour = () => {
    recordAbandonedTour();
    tour.stop();
    narration.stop();
    walker.stop();
  };
  const rejoinTour = () => {
    if (!tour.target) return;
    walker.stop();
    tour.rejoin();
  };

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return {
    catalog,
    tour,
    collection,
    walker,
    narration,
    go: explore,
    listen,
    toggleNarration,
    now,
    pauseTour,
    resumeTour,
    startTour,
    stopTour,
    nextTour: confirmNext,
    rejoinTour,
  };
}
