import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function GrowCycle() {
  return (
    <>
      <ContentHeader title="Grow Cycle" crumbs={["Manage"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="cycle"
          title="No active grow"
          description="Start a new grow cycle to track stages, run stage-scoped automations, and capture a harvest report."
          hint="Start a grow cycle"
        />
      </div>
    </>
  );
}
