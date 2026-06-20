import { useState, useRef } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Icon } from "@/components/Icon";
import {
  useWorkspaces,
  useActiveWorkspace,
  useCreateWorkspace,
  useSetActiveWorkspace,
} from "@/hooks/useWorkspace";
import { cn } from "@/lib/utils";

export function WorkspaceSelector() {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: workspaceList = [] } = useWorkspaces();
  const active = useActiveWorkspace();
  const createWs = useCreateWorkspace();
  const setActive = useSetActiveWorkspace();

  const handleCreate = () => {
    const name = newName.trim();
    if (!name || createWs.isPending) return;
    createWs.mutate(name, {
      onSuccess: () => {
        setNewName("");
        setOpen(false);
      },
    });
  };

  const handleSwitch = (id: string) => {
    if (id === active?.id) { setOpen(false); return; }
    setActive.mutate(id, { onSuccess: () => setOpen(false) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="workspace" role="button" tabIndex={0}>
          <div className="ws-ico">
            <Icon name="leaf" size={14} />
          </div>
          <div className="ws-meta">
            <div className="ws-name">{active?.name ?? "Select workspace"}</div>
            <div className="ws-sub">
              <span
                className="dot-live"
                style={{
                  animation: "none",
                  width: 6,
                  height: 6,
                  flexShrink: 0,
                  opacity: active?.activeGrowId ? 1 : 0.5,
                }}
              />
              {active?.activeGrowId ? "Active grow" : "No active grow"}
            </div>
          </div>
          <span className={cn("chev", open && "chev-open")}>
            <Icon name="chevron" size={14} />
          </span>
        </div>
      </PopoverTrigger>

      <PopoverContent
        className="ws-picker p-0"
        side="bottom"
        align="start"
        sideOffset={6}
        style={{ width: 224 }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="ws-list">
          {workspaceList.length === 0 ? (
            <div className="ws-empty">No workspaces yet</div>
          ) : (
            workspaceList.map((ws) => (
              <button
                key={ws.id}
                className={cn("ws-item", ws.id === active?.id && "active")}
                onClick={() => handleSwitch(ws.id)}
              >
                <span className="ws-item-name">{ws.name}</span>
                {ws.id === active?.id && (
                  <span className="ws-chk">
                    <Icon name="check" size={12} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="ws-footer">
          <input
            ref={inputRef}
            className="ws-input"
            placeholder="New workspace…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button
            className="btn primary sm btn-icon"
            onClick={handleCreate}
            disabled={!newName.trim() || createWs.isPending}
            title="Create workspace"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
