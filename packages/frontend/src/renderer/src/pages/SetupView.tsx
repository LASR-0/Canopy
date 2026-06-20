import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function SetupView() {
  return (
    <>
      <ContentHeader title="Setup View" crumbs={["Monitor"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="setup"
          title="Visual layout coming soon"
          description="The tent layout designer — device, sensor, and pot placement — will be designed and built in a future phase."
        />
      </div>
    </>
  );
}
