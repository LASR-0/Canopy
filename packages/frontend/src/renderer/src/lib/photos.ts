import { ApiError, BACKEND_URL } from "@/lib/http";
import type { ApiResponse, JournalPhoto } from "@canopy/shared-types";

/** Longest edge a stored photo keeps. Plenty for a screen and for print. */
export const PHOTO_MAX_EDGE = 2400;
const PHOTO_QUALITY = 0.85;

export const ACCEPTED_PHOTOS = "image/jpeg,image/png,image/webp";

export const photoUrl = (id: string) => `${BACKEND_URL}/journal-photos/${id}`;

/**
 * Shrink a photo before it leaves the renderer: a phone's 12 MP original is
 * several megabytes, and the controller may be a Pi on the same Wi-Fi.
 * Re-encoding also drops the metadata, the location among it, and
 * `createImageBitmap` applies the camera's rotation so the pixels come out
 * upright.
 */
export async function shrinkPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} could not be read. JPEG, PNG and WebP work; export HEIC photos as JPEG first.`);
  }
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
  if (!blob) throw new Error(`${file.name} could not be converted`);
  return { blob, width, height };
}

/**
 * Upload a photo for an entry not saved yet. The body is the image itself,
 * which is why this is not `api()`: that helper sends JSON.
 */
export async function uploadPhoto(workspaceId: string, file: File): Promise<JournalPhoto> {
  const { blob, width, height } = await shrinkPhoto(file);
  const res = await fetch(`${BACKEND_URL}/workspaces/${workspaceId}/journal-photos?width=${width}&height=${height}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  const json = (await res.json()) as ApiResponse<JournalPhoto>;
  if (!json.ok) throw new ApiError(json.error.code, json.error.message, json.error.details);
  return json.data;
}
