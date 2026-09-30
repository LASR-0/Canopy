import { useEffect, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useSetActiveWorkspace } from "@/hooks/useWorkspace";
import { api, BACKEND_URL } from "@/lib/http";
import { cn } from "@/lib/utils";
import type { ApiResponse, ImportPreview, ImportStatus } from "@canopy/shared-types";

type Step = "choose" | "uploading" | "review" | "importing" | "done" | "error";

const STEPS = ["Choose file", "Review", "Import"] as const;
const stepIndex = (step: Step) => (step === "choose" || step === "uploading" ? 0 : step === "review" ? 1 : 2);

const n = (v: number) => v.toLocaleString();
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

/**
 * Upload with progress. `fetch` cannot report an upload's progress, and a
 * file can be hundreds of megabytes, so this is XMLHttpRequest.
 */
function uploadExport(file: File, onProgress: (fraction: number) => void): Promise<ImportPreview> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BACKEND_URL}/data/import`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText) as ApiResponse<ImportPreview>;
        if (json.ok) resolve(json.data);
        else reject(new Error(json.error.message));
      } catch {
        reject(new Error("The controller gave an answer Canopy could not read"));
      }
    };
    xhr.onerror = () => reject(new Error("The controller could not be reached"));
    xhr.send(file);
  });
}

/**
 * Import workspaces from a `.canopy` file, beside the ones here: choose the
 * file, see what is in it and pick what to bring in, then watch it copy. The
 * new workspaces are live as soon as it finishes, with no restart.
 */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const setActive = useSetActiveWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("choose");
  const [fileName, setFileName] = useState("");
  const [uploaded, setUploaded] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setStep("choose");
    setFileName("");
    setUploaded(0);
    setPreview(null);
    setChosen(new Set());
    setStatus(null);
    setError("");
  };

  // Leaving at review throws the staged file away; the controller also clears
  // staging on its next start.
  const close = () => {
    if (preview && step === "review") void api("DELETE /data/import/:token", { params: { token: preview.token } }).catch(() => {});
    if (step !== "importing") {
      reset();
      onClose();
    }
  };

  const choose = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setStep("uploading");
    uploadExport(file, setUploaded).then(
      (p) => {
        setPreview(p);
        // Everything but archived workspaces, which are usually not wanted again.
        setChosen(new Set(p.workspaces.filter((w) => !w.archived).map((w) => w.id)));
        setStep("review");
      },
      (e: Error) => { setError(e.message); setStep("error"); },
    );
  };

  const start = async () => {
    if (!preview) return;
    setStep("importing");
    try {
      setStatus(await api("POST /data/import/:token/apply", { params: { token: preview.token }, body: { workspaceIds: [...chosen] } }));
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  };

  // Follow the copy until it ends.
  useEffect(() => {
    if (step !== "importing" || !preview) return;
    const timer = setInterval(async () => {
      try {
        const s = await api("GET /data/import/:token", { params: { token: preview.token } });
        setStatus(s);
        if (s.state === "done") {
          setStep("done");
          // New workspaces, devices, automations: everything may have changed.
          void qc.invalidateQueries();
        } else if (s.state === "failed") {
          setError(s.error ?? "The import failed; nothing was added");
          setStep("error");
        }
      } catch {
        // A missed poll is retried on the next tick.
      }
    }, 500);
    return () => clearInterval(timer);
  }, [step, preview, qc]);

  if (!open) return null;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    choose(e.dataTransfer.files[0]);
  };
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const at = stepIndex(step);
  const selected = preview?.workspaces.filter((w) => chosen.has(w.id)) ?? [];
  const alreadyHere = selected.reduce((sum, w) => sum + w.devicesAlreadyHere, 0);
  const fraction = status?.total ? (status.done ?? 0) / status.total : 0;

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal prov-modal import-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-labelledby="import-title">
        <div className="modal-head">
          <Icon name="arrow-down" size={16} />
          <h3 id="import-title">Import workspaces</h3>
          <button className="icon-ghost" onClick={close} disabled={step === "importing"} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="modal-steps">
          {STEPS.map((label, i) => (
            <div key={label} className={cn("mstep", i === at && "on", (i < at || step === "done") && "done")}>
              <span className="mstep-n">{i < at || step === "done" ? <Icon name="check" size={10} /> : i + 1}</span>
              {label}
              {i < STEPS.length - 1 && <span className="mstep-sep" />}
            </div>
          ))}
        </div>

        <div className="modal-body">
          {step === "choose" && (
            <div className="prov-step">
              <p className="prov-hint">
                Choose a <b>.canopy</b> file exported from Canopy. Its workspaces are added beside yours, with their
                grows, journal, photos, automations, devices and history. Nothing here is changed.
              </p>
              <button className="imp-drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
                <Icon name="arrow-down" size={20} />
                <span>Drop the file here, or click to choose it</span>
              </button>
              <input ref={input} type="file" accept=".canopy" hidden onChange={(e) => choose(e.target.files?.[0])} />
            </div>
          )}

          {step === "uploading" && (
            <div className="prov-step">
              <p className="prov-hint">{uploaded < 1 ? `Uploading ${fileName}…` : "Checking the file…"}</p>
              <div className="imp-bar"><span style={{ width: `${Math.round(uploaded * 100)}%` }} /></div>
            </div>
          )}

          {step === "review" && preview && (
            <div className="prov-step">
              <p className="prov-hint">
                Exported {new Date(preview.exportedAt).toLocaleString()}. Choose the workspaces to add.
              </p>
              <div className="imp-list">
                {preview.workspaces.map((w) => (
                  <label key={w.id} className={cn("imp-ws", chosen.has(w.id) && "on")}>
                    <input type="checkbox" checked={chosen.has(w.id)} onChange={() => toggle(w.id)} />
                    <span className="imp-ws-body">
                      <span className="imp-ws-name">
                        {w.importedName ?? w.name}
                        {w.archived && <span className="tag b-idle" style={{ fontSize: 10 }}>archived</span>}
                      </span>
                      <span className="imp-ws-counts">
                        {plural(w.grows, "grow")} · {plural(w.entries, "journal entry", "journal entries")} · {plural(w.photos, "photo")}
                        {" · "}{plural(w.automations, "automation")} · {plural(w.devices, "device")} · {plural(w.readings, "reading")}
                      </span>
                      {w.importedName && <span className="imp-ws-note">You already have a “{w.name}”, so this one is added as “{w.importedName}”.</span>}
                    </span>
                  </label>
                ))}
              </div>
              {alreadyHere > 0 && (
                <p className="prov-hint imp-warn">
                  <Icon name="info" size={13} /> {plural(alreadyHere, "device")} in this file {alreadyHere === 1 ? "is" : "are"} already
                  here. {alreadyHere === 1 ? "It stays" : "They stay"} where {alreadyHere === 1 ? "it is" : "they are"}; the imported
                  {alreadyHere === 1 ? " copy is" : " copies are"} kept for history but not read from or driven.
                </p>
              )}
            </div>
          )}

          {step === "importing" && (
            <div className="prov-step">
              <p className="prov-hint">{status?.step ?? "Starting"}…</p>
              <div className="imp-bar"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
              {status?.total ? <p className="imp-sub">{n(status.done ?? 0)} of {n(status.total)} readings</p> : null}
              <p className="imp-sub">The controller keeps running while this copies.</p>
            </div>
          )}

          {step === "done" && status?.result && (
            <div className="prov-step prov-success">
              <span className="prov-success-ico"><Icon name="check" size={26} /></span>
              <h4>{status.result.length === 1 ? "Workspace added" : `${status.result.length} workspaces added`}</h4>
              <div className="imp-result">
                {status.result.map((w) => (
                  <div key={w.id} className="imp-result-row">
                    <span className="imp-ws-name">{w.name}</span>
                    <span className="imp-ws-counts">
                      {plural(w.grows, "grow")} · {plural(w.devices, "device")}
                      {w.detachedDevices > 0 && ` (${n(w.detachedDevices)} detached)`} · {plural(w.readings, "reading")} · {plural(w.photos, "photo")}
                    </span>
                    <button className="btn sm" onClick={() => { setActive.mutate(w.id); reset(); onClose(); }}>Open</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "error" && (
            <div className="prov-step prov-error">
              <span className="prov-error-ico"><Icon name="alert" size={26} /></span>
              <h4>Nothing was imported</h4>
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <span className="spacer" />
          {step === "review" && (
            <>
              <button className="btn" onClick={close}>Cancel</button>
              <button className="btn primary" onClick={() => void start()} disabled={chosen.size === 0}>
                <Icon name="arrow-down" size={13} /> Import {chosen.size === 1 ? "1 workspace" : `${chosen.size} workspaces`}
              </button>
            </>
          )}
          {step === "error" && (
            <>
              <button className="btn" onClick={close}>Close</button>
              <button className="btn primary" onClick={reset}>Try another file</button>
            </>
          )}
          {(step === "choose" || step === "done") && <button className="btn" onClick={close}>{step === "done" ? "Done" : "Cancel"}</button>}
        </div>
      </div>
    </div>
  );
}
