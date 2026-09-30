import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { ACCEPTED_PHOTOS, photoUrl, uploadPhoto } from "@/lib/photos";
import { cn } from "@/lib/utils";
import type { JournalPhoto, JournalPhotoRef } from "@canopy/shared-types";

// ── Showing photos ────────────────────────────────────────────────────────────

/**
 * One photo as a Polaroid: a light frame with a deeper bottom edge, and the
 * caption written in that band. The frame is square, as the originals were, so
 * a portrait and a landscape shot sit the same size in the notebook; the full
 * photo is a click away.
 */
function Polaroid({ photo, onOpen, hidden, children }: {
  photo: JournalPhoto;
  onOpen: () => void;
  /** Off screen in a carousel, but still printed. */
  hidden?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <figure className={cn("polaroid", hidden && "pol-off")}>
      <button className="pol-img" onClick={onOpen} aria-label={photo.caption ? `Open photo: ${photo.caption}` : "Open photo"}>
        <img src={photoUrl(photo.id)} alt={photo.caption ?? ""} loading="lazy" draggable={false} />
      </button>
      {children}
      <figcaption className={cn("pol-caption", !photo.caption && "empty")}>{photo.caption}</figcaption>
    </figure>
  );
}

/**
 * An entry's photos: one is a Polaroid on its own, several are a carousel of
 * Polaroids with arrows, dots and a count. Arrow keys move it when focused.
 */
export function EntryPhotos({ photos }: { photos: JournalPhoto[] }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const at = Math.min(index, photos.length - 1);
  if (photos.length === 0) return null;

  const step = (by: number) => setIndex((i) => (i + by + photos.length) % photos.length);
  const onKey = (e: KeyboardEvent) => {
    if (photos.length < 2) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  };

  return (
    <div className="je-photos" tabIndex={photos.length > 1 ? 0 : -1} onKeyDown={onKey} aria-roledescription={photos.length > 1 ? "carousel" : undefined}>
      {/* Every photo is rendered and the rest hidden, so a printed page, which
          cannot page through a carousel, shows them all. */}
      {photos.map((photo, i) => (
        <Polaroid key={photo.id} photo={photo} onOpen={() => setOpen(i)} hidden={i !== at}>
          {i === at && photos.length > 1 && (
            <>
              <button className="pol-nav prev" onClick={() => step(-1)} aria-label="Previous photo"><Icon name="chevron" size={16} /></button>
              <button className="pol-nav next" onClick={() => step(1)} aria-label="Next photo"><Icon name="chevron" size={16} /></button>
              <span className="pol-count">{at + 1} / {photos.length}</span>
            </>
          )}
        </Polaroid>
      ))}
      {photos.length > 1 && (
        <div className="pol-dots" role="tablist" aria-label="Photos">
          {photos.map((p, i) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={i === at}
              aria-label={`Photo ${i + 1}`}
              className={cn("pol-dot", i === at && "on")}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
      {open !== null && (
        <Lightbox photos={photos} index={open} onIndex={(i) => { setOpen(i); setIndex(i); }} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/** The whole photo, uncropped, over the page. Arrows and Esc work. */
function Lightbox({ photos, index, onIndex, onClose }: {
  photos: JournalPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index]!;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (photos.length > 1 && e.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
      if (photos.length > 1 && e.key === "ArrowRight") onIndex((index + 1) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex, onClose]);

  return createPortal(
    <div className="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal aria-label="Photo">
      <button className="lb-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      {photos.length > 1 && (
        <button className="lb-nav prev" onClick={() => onIndex((index - 1 + photos.length) % photos.length)} aria-label="Previous photo">
          <Icon name="chevron" size={22} />
        </button>
      )}
      <figure className="lb-figure">
        <img src={photoUrl(photo.id)} alt={photo.caption ?? ""} />
        {(photo.caption || photos.length > 1) && (
          <figcaption>
            {photo.caption}
            {photos.length > 1 && <span className="lb-count">{index + 1} / {photos.length}</span>}
          </figcaption>
        )}
      </figure>
      {photos.length > 1 && (
        <button className="lb-nav next" onClick={() => onIndex((index + 1) % photos.length)} aria-label="Next photo">
          <Icon name="chevron" size={22} />
        </button>
      )}
    </div>,
    document.body,
  );
}

// ── Editing photos ────────────────────────────────────────────────────────────

/** A photo in the composer: uploaded, still uploading, or failed. */
export interface DraftPhoto {
  /** Stable across the upload finishing, for React and for reordering. */
  key: string;
  /** Set once uploaded. */
  photo?: JournalPhoto;
  caption: string;
  /** A local preview while the upload runs. */
  preview?: string;
  error?: string;
}

export const draftPhotosFrom = (photos: JournalPhoto[] = []): DraftPhoto[] =>
  photos.map((p) => ({ key: p.id, photo: p, caption: p.caption ?? "" }));

/** What the entry is saved with: the uploaded photos, in order, with captions. */
export const photoRefs = (drafts: DraftPhoto[]): JournalPhotoRef[] =>
  drafts.filter((d) => d.photo).map((d) => ({ id: d.photo!.id, ...(d.caption.trim() ? { caption: d.caption.trim() } : {}) }));

export const uploading = (drafts: DraftPhoto[]) => drafts.some((d) => !d.photo && !d.error);

const pickFiles = (files: FileList | File[]) => [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));

type DraftUpdate = (update: (drafts: DraftPhoto[]) => DraftPhoto[]) => void;

/**
 * Adding photos: each is shown at once from a local preview and uploaded in
 * the background, so saving the entry is quick. The controller clears any
 * upload that ends up in no entry.
 */
export function usePhotoAdder(workspaceId: string, onChange: DraftUpdate): (files: FileList | File[]) => void {
  // Local previews are released when the composer goes.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  return (files) => {
    for (const file of pickFiles(files)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      onChange((d) => [...d, { key, caption: "", preview }]);
      uploadPhoto(workspaceId, file).then(
        (photo) => onChange((d) => d.map((x) => (x.key === key ? { ...x, photo } : x))),
        (error: Error) => onChange((d) => d.map((x) => (x.key === key ? { ...x, error: error.message } : x))),
      );
    }
  };
}

/**
 * The composer's photos: an "Add photos" button, and a strip of the photos
 * with a caption each, reorderable (drag, or the arrow buttons) and removable.
 */
export function PhotoEditor({ drafts, onChange, onAdd }: {
  drafts: DraftPhoto[];
  onChange: DraftUpdate;
  onAdd: (files: FileList | File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);

  const move = (from: number, to: number) =>
    onChange((d) => {
      if (to < 0 || to >= d.length || from === to) return d;
      const next = [...d];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });

  const onDropOnThumb = (e: DragEvent, to: number) => {
    if (dragFrom.current === null) return;
    e.preventDefault();
    e.stopPropagation();
    move(dragFrom.current, to);
    dragFrom.current = null;
  };

  return (
    <div className="jc-photos">
      {drafts.length > 0 && (
        <div className="jp-strip">
          {drafts.map((d, i) => (
            <div
              key={d.key}
              className={cn("jp-item", d.error && "failed")}
              draggable={!!d.photo}
              onDragStart={() => { dragFrom.current = i; }}
              onDragOver={(e) => dragFrom.current !== null && e.preventDefault()}
              onDrop={(e) => onDropOnThumb(e, i)}
            >
              <div className="jp-thumb">
                <img src={d.photo ? photoUrl(d.photo.id) : d.preview} alt="" draggable={false} />
                {!d.photo && !d.error && <span className="jp-busy"><span className="spinner" /></span>}
                {d.error && (
                  <Tip content={d.error}>
                    <span className="jp-failed"><Icon name="alert" size={14} /> Not uploaded</span>
                  </Tip>
                )}
                <span className="jp-tools">
                  <button className="jp-tool" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move earlier">
                    <Icon name="arrow-left" size={11} />
                  </button>
                  <button className="jp-tool" onClick={() => move(i, i + 1)} disabled={i === drafts.length - 1} aria-label="Move later">
                    <Icon name="arrow-right" size={11} />
                  </button>
                  <button className="jp-tool del" onClick={() => onChange((all) => all.filter((x) => x.key !== d.key))} aria-label="Remove photo">
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
              <input
                className="jp-caption"
                value={d.caption}
                placeholder="Caption"
                maxLength={280}
                onChange={(e) => onChange((all) => all.map((x) => (x.key === d.key ? { ...x, caption: e.target.value } : x)))}
                aria-label={`Caption for photo ${i + 1}`}
              />
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_PHOTOS}
        multiple
        hidden
        onChange={(e) => { if (e.target.files) onAdd(e.target.files); e.target.value = ""; }}
      />
      <button className="btn sm" onClick={() => input.current?.click()} disabled={drafts.length >= 20}>
        <Icon name="camera" size={13} /> {drafts.length ? "Add more photos" : "Add photos"}
      </button>
    </div>
  );
}

/** Photos dropped anywhere on the composer are added, as if picked. */
export function photoDropProps(onFiles: (files: File[]) => void) {
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  return {
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      onFiles(pickFiles(e.dataTransfer.files));
    },
  };
}
