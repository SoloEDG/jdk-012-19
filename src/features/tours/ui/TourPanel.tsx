import { Route, ArrowRight, Pause, Play, X, Clock, RotateCcw } from "lucide-react";
import { routes, artworkById } from "../../../shared/catalog";
import type { TourState } from "../../../shared/types";
import {
  tourProgress,
  tourRoute,
  tourTarget,
  tourTiming,
  formatClock,
  formatDuration,
  formatApproxMinutes,
  plannedRouteMs,
  needsPaceChoice,
  type TourTiming,
} from "../lib/routeProgress";

const PHASE_LABEL: Record<string, string> = {
  walking: "正在前往",
  arrived: "已抵达",
  attending: "正在观看",
  listening: "正在讲解",
  awaiting: "讲解已结束 · 等你决定",
  left: "已离开这一站",
  done: "已完成",
};

export function TourPanel({
  state,
  now,
  currentElapsed,
  onStart,
  onPause,
  onResume,
  onStop,
  onNext,
  onRejoin,
  onExtend,
  onTighten,
}: {
  state: TourState;
  now: number;
  currentElapsed?: number | null;
  onStart: (id: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onNext: () => void;
  onRejoin: () => void;
  onExtend: (delayMs: number) => void;
  onTighten: (delayMs: number) => void;
}) {
  const current = tourRoute(state);
  // The timing block is only meaningful while a route is running; for done or
  // idle states the ETA would be stale noise.
  const timing = tourTiming(state, now, currentElapsed);

  return (
    <section className="tour-panel">
      <div className="section-title">
        <Route size={16} />
        <span>主题导览</span>
        <small>CURATED JOURNEYS</small>
      </div>
      {current && state.phase !== "idle" ? (
        <div className="current-tour">
          <span className="eyebrow">
            正在探索 ·{" "}
            {state.phase === "done"
              ? "已完成"
              : `${state.step + 1} / ${current.stops.length}`}
          </span>
          <h3>{current.name}</h3>
          <progress value={tourProgress(state)} max="1" />
          <p className="tour-phase">
            <span className={"phase-dot phase-" + state.phase} />
            {state.paused ? "导览已暂停" : PHASE_LABEL[state.phase]}
            {state.phase !== "done" && state.phase !== "walking" && (
              <>
                {" · "}
                {artworkById(tourTarget(state) || "")?.title}
              </>
            )}
          </p>
          {state.phase !== "done" ? (
            <TimingBlock
              state={state}
              timing={timing}
              onExtend={() => onExtend(timing.delayMs)}
              onTighten={() => onTighten(timing.delayMs)}
            />
          ) : (
            <p className="tour-done">
              已完成 {current.stops.length} 站，实际用时{" "}
              {formatDuration(
                (state.completedAt ?? now) - (state.startedAt ?? now),
              )}
              。
            </p>
          )}
          <div className="tour-controls">
            {state.phase !== "done" && (
              <>
                {state.phase === "left" ? (
                  <button onClick={onRejoin}>
                    <RotateCcw size={14} />
                    回到这一站
                  </button>
                ) : (
                  <button onClick={state.paused ? onResume : onPause}>
                    {state.paused ? <Play size={14} /> : <Pause size={14} />}
                    {state.paused ? "继续" : "暂停"}
                  </button>
                )}
                <button onClick={onNext} disabled={state.paused}>
                  {state.phase === "awaiting" ? "确认，去下一站" : "跳过本站"}
                  <ArrowRight size={14} />
                </button>
              </>
            )}
            <button aria-label="结束导览" onClick={onStop}>
              <X size={14} />
            </button>
          </div>
        </div>
      ) : (
        routes.map((r, i) => (
          <button
            className={"route-card route-" + i}
            key={r.id}
            onClick={() => onStart(r.id)}
          >
            <span>
              JOURNEY 0{i + 1}{" "}
              <span>
                {formatApproxMinutes(plannedRouteMs(r))} · {r.stops.length} 件作品
              </span>
            </span>
            <h3>
              {r.name}
              <ArrowUpRightIcon />
            </h3>
            <p>{r.subtitle}</p>
          </button>
        ))
      )}
    </section>
  );
}

function TimingBlock({
  state,
  timing,
  onExtend,
  onTighten,
}: {
  state: TourState;
  timing: TourTiming;
  onExtend: (delayMs: number) => void;
  onTighten: (delayMs: number) => void;
}) {
  const late = timing.delayMs;
  const needsChoice = needsPaceChoice(state, late);
  return (
    <div className="tour-timing">
      <p className="timing-row">
        <Clock size={13} />
        <span>
          预计 {formatClock(timing.projectedFinishAt)} 完成
          {timing.plannedFinishAt != null && (
            <small> · 原计划 {formatClock(timing.plannedFinishAt)}</small>
          )}
        </span>
      </p>
      <p className="timing-row">
        <span>
          本站实际停留 {formatDuration(state.stopDwellMs)}
          <small> · 路线完成 {state.confirmedStops.length} 站已确认</small>
        </span>
      </p>
      {late > 0 && (
        <p className={"timing-note" + (needsChoice ? " urgent" : "")}>
          按现在的节奏，会比原计划晚 {formatDuration(late)}。
          {state.extended && " 已选择延长，可以安心看完。"}
          {state.tightened && " 已选择压缩后续讲解节奏。"}
        </p>
      )}
      {needsChoice && (
        <div className="pace-choice" role="group" aria-label="节奏选择">
          <button onClick={() => onExtend(late)}>
            <Clock size={13} />
            多留一会儿
          </button>
          <button onClick={() => onTighten(late)}>
            <ArrowRight size={13} />
            压缩后续 · 保持准时
          </button>
        </div>
      )}
    </div>
  );
}

function ArrowUpRightIcon() {
  return <span className="round-arrow">↗</span>;
}
