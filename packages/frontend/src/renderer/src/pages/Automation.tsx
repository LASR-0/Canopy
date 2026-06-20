import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function Automation() {
  return (
    <>
      <ContentHeader title="Automation" crumbs={["Manage"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="automation"
          title="No automations yet"
          description="Schedules and rules will appear here once you have devices connected and roles assigned."
          hint="Requires connected devices"
        />
      </div>
    </>
  );
}
