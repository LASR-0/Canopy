import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function Journal() {
  return (
    <>
      <ContentHeader title="Journal" crumbs={["Manage"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="journal"
          title="No journal entries"
          description="Journal entries, grow history, and cross-grow comparisons will appear here once a grow cycle is started."
          hint="Requires an active grow cycle"
        />
      </div>
    </>
  );
}
