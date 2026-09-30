import { STAGE_DEFS } from "@/lib/growStage";
import { cn } from "@/lib/utils";
import type { PlannedStage } from "@canopy/shared-types";

export const stageLabel = (stage: PlannedStage) => STAGE_DEFS.find((d) => d.stage === stage)?.label ?? stage;
export const stageColor = (stage: PlannedStage) => STAGE_DEFS.find((d) => d.stage === stage)?.color ?? "var(--fg-muted)";

/**
 * Which grow stages something runs in: "Every stage", or any set of stages.
 * Picking a stage narrows it; picking "Every stage" clears the set.
 */
export function StageScope({ value, onChange }: {
  value: readonly PlannedStage[];
  onChange: (stages: PlannedStage[]) => void;
}) {
  const toggle = (stage: PlannedStage) => {
    const next = value.includes(stage) ? value.filter((s) => s !== stage) : [...value, stage];
    // Kept in plan order, whatever order they were ticked in.
    onChange(STAGE_DEFS.map((d) => d.stage).filter((s) => next.includes(s)));
  };
  return (
    <div className="tf-chips" role="group" aria-label="Runs in">
      <button className={cn("tf-chip", value.length === 0 && "on")} aria-pressed={value.length === 0} onClick={() => onChange([])}>
        Every stage
      </button>
      {STAGE_DEFS.map((d) => (
        <button
          key={d.stage}
          className={cn("tf-chip stage-chip", value.includes(d.stage) && "on")}
          aria-pressed={value.includes(d.stage)}
          style={value.includes(d.stage) ? { color: d.color, borderColor: d.color } : undefined}
          onClick={() => toggle(d.stage)}
        >
          <span className="stage-dot" style={{ background: d.color }} /> {d.label}
        </button>
      ))}
    </div>
  );
}

/** A scope, shown small on a card or a row. Nothing for "every stage". */
export function StageTags({ stages }: { stages?: readonly PlannedStage[] | undefined }) {
  if (!stages || stages.length === 0) return null;
  return (
    <span className="stage-tags">
      {stages.map((s) => (
        <span key={s} className="stage-tag" style={{ color: stageColor(s), background: `${stageColor(s)}1f` }}>
          {stageLabel(s)}
        </span>
      ))}
    </span>
  );
}
