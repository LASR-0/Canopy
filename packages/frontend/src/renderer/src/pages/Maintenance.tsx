import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function Maintenance() {
  return (
    <>
      <ContentHeader title="Maintenance" crumbs={["Service"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="maintenance"
          title="Maintenance tracker coming soon"
          description="Recurring reminders for sensor cleaning, filter swaps, nutrient top-ups, and calibration will be designed and built in a future phase."
        />
      </div>
    </>
  );
}
