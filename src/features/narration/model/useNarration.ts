import { useState, useEffect, useRef } from "react";
import type { AudioState, NarrationEnd } from "../../../shared/types";
import { artworkById } from "../../../shared/catalog";
import { captionAt } from "../lib/timeline";
import { speak, stopSpeech } from "../lib/speech";

export type PlayOptions = {
  /** Tour intent this playback serves. Omit for free exploration. */
  intent?: number | null;
  origin?: "tour" | "manual";
  /** Start position in seconds; defaults to resuming the same artwork. */
  from?: number;
  /** Playback speed. Used to catch up later stops without cutting audio. */
  rate?: number;
};

export function useNarration(onEnd: (event: NarrationEnd) => void) {
  const [state, setState] = useState<AudioState>({
    artworkId: null,
    elapsed: 0,
    playing: false,
    rate: 1,
    completed: false,
    intent: null,
    origin: null,
  });
  const callback = useRef(onEnd);
  callback.current = onEnd;
  const [supported, setSupported] = useState(true);
  /** Guards against emitting more than one end event per playback session. */
  const endSent = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!state.playing) return;
    let previous = performance.now();
    const advance = () => {
      const now = performance.now();
      const delta = (now - previous) / 1000;
      previous = now;
      // Wall-clock delta, never a fixed tick. A throttled background tab
      // therefore resumes at the position it would have reached, instead of
      // silently losing the time spent away.
      setState((s) => ({ ...s, elapsed: s.elapsed + delta * s.rate }));
    };
    const t = setInterval(advance, 150);
    // On returning to the foreground, catch up at once rather than waiting
    // for the next tick.
    const onVisibility = () => {
      if (document.visibilityState === "visible") advance();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state.playing]);
  const a = artworkById(state.artworkId);
  const caption = a ? captionAt(a, state.elapsed) : "";
  useEffect(() => {
    if (state.playing && caption) setSupported(speak(caption, state.rate));
    else stopSpeech();
    return stopSpeech;
  }, [caption, state.playing, state.rate]);
  useEffect(() => {
    if (!a || !state.playing || state.elapsed < a.duration) return;
    if (endSent.current) return;
    endSent.current = true;
    setState((s) => ({
      ...s,
      playing: false,
      elapsed: a.duration,
      completed: true,
    }));
    callback.current({
      artworkId: a.id,
      intent: state.intent,
      origin: state.origin,
      elapsed: a.duration,
    });
  }, [state.elapsed, state.playing, state.intent, state.origin, a]);
  return {
    state,
    caption,
    supported,
    /**
     * Start (or continue) playback. `from` lets a returning visitor pick up
     * where they stopped instead of restarting the whole narration.
     */
    play: (id: string, options: PlayOptions = {}) =>
      setState((s) => {
        const artwork = artworkById(id);
        if (!artwork) return s;
        const sameArtwork = s.artworkId === id;
        const canResume =
          sameArtwork && s.elapsed > 0 && s.elapsed < artwork.duration;
        const from =
          options.from != null
            ? Math.max(0, Math.min(options.from, artwork.duration))
            : canResume
              ? s.elapsed
              : 0;
        endSent.current = from >= artwork.duration;
        return {
          ...s,
          artworkId: id,
          elapsed: from,
          playing: true,
          rate: options.rate ?? s.rate,
          completed: from >= artwork.duration,
          intent: options.intent ?? null,
          origin: options.origin ?? "manual",
        };
      }),
    pause: () =>
      setState((s) => (s.playing ? { ...s, playing: false } : s)),
    stop: () =>
      setState((s) => ({
        ...s,
        playing: false,
        intent: null,
        origin: null,
        completed: false,
      })),
    toggle: () =>
      setState((s) => {
        if (!s.playing) {
          endSent.current = false;
          return { ...s, playing: true, completed: false };
        }
        return { ...s, playing: false };
      }),
    seek: (elapsed: number) =>
      setState((s) => {
        endSent.current = false;
        return { ...s, elapsed, completed: false };
      }),
    rate: (rate: number) => setState((s) => ({ ...s, rate })),
  };
}
