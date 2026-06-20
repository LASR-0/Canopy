import { ContentHeader } from "@/components/ContentHeader";
import { EmptyState } from "@/components/EmptyState";

export function Logging() {
  return (
    <>
      <ContentHeader title="Logging" crumbs={["Service"]} />
      <div className="flex-1 overflow-y-auto">
        <EmptyState
          icon="logging"
          title="No sensor history yet"
          description="Historical charts and per-grow log archives will appear here once readings are being collected."
          hint="Requires connected devices"
        />
      </div>
    </>
  );
}
