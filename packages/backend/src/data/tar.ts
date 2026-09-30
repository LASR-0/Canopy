/**
 * Just enough tar for a Canopy export: regular files, written and read as a
 * stream. A `.canopy` file is this, gzipped, so any archive tool opens it once
 * renamed to `.tar.gz`, and Canopy needs no archive dependency.
 *
 * ustar headers only. Names are short and ASCII (the export chooses them), and
 * sizes fit ustar's 8 GB field.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";

const BLOCK = 512;

export interface TarSource {
  name: string;
  size: number;
  /** The file to stream from, or the bytes themselves. */
  path?: string;
  data?: Buffer;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

export function tarHeader(name: string, size: number, mtime: Date = new Date()): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, "ascii");                            // mode
  h.write(octal(0, 8), 108, "ascii");                                // uid
  h.write(octal(0, 8), 116, "ascii");                                // gid
  h.write(octal(size, 12), 124, "ascii");                            // size
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  h.write("        ", 148, "ascii");                                 // checksum, as spaces while summing
  h.write("0", 156, "ascii");                                        // regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(octal(sum, 7) + " ", 148, "ascii");
  return h;
}

const padding = (size: number) => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);

/** The archive as a stream of chunks. Files are read as they are reached. */
export async function* tarStream(sources: Iterable<TarSource> | AsyncIterable<TarSource>): AsyncGenerator<Buffer> {
  for await (const source of sources) {
    yield tarHeader(source.name, source.size);
    if (source.data) {
      yield source.data;
    } else if (source.path) {
      for await (const chunk of createReadStream(source.path)) yield chunk as Buffer;
    }
    const pad = padding(source.size);
    if (pad.length) yield pad;
  }
  yield Buffer.alloc(BLOCK * 2);
}

export interface TarEntry {
  name: string;
  size: number;
}

/**
 * Read an archive, handing each file to `open`, which says where to write it
 * (or null to skip it). Streams, so a large database is never held in memory.
 * Throws on a malformed archive.
 */
export async function extractTar(
  input: AsyncIterable<Buffer>,
  open: (entry: TarEntry) => string | null,
): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let file: { entry: TarEntry; remaining: number; out: ReturnType<typeof createWriteStream> | null; skip: number } | null = null;
  let finished = false;

  const writeOut = async (chunk: Buffer) => {
    if (!file?.out) return;
    if (!file.out.write(chunk)) await once(file.out, "drain");
  };
  const closeOut = async () => {
    if (file?.out) {
      file.out.end();
      await once(file.out, "finish");
    }
  };

  for await (const chunk of input) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (!finished) {
      if (file) {
        if (file.remaining > 0) {
          if (pending.length === 0) break;
          const take = Math.min(file.remaining, pending.length);
          await writeOut(pending.subarray(0, take));
          pending = pending.subarray(take);
          file.remaining -= take;
          if (file.remaining > 0) break;
        }
        if (pending.length < file.skip) break;
        pending = pending.subarray(file.skip);
        await closeOut();
        entries.push(file.entry);
        file = null;
        continue;
      }
      if (pending.length < BLOCK) break;
      const header = pending.subarray(0, BLOCK);
      pending = pending.subarray(BLOCK);
      if (header.every((b) => b === 0)) { finished = true; break; }

      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
      const stored = parseInt(header.toString("ascii", 148, 156).replace(/\0.*$/, "").trim(), 8);
      if (sum !== stored) throw new Error("Not a Canopy export: the archive is damaged");

      const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/s, "");
      const base = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
      const name = prefix ? `${prefix}/${base}` : base;
      const size = parseInt(header.toString("ascii", 124, 136).replace(/\0.*$/, "").trim() || "0", 8);
      const type = header.toString("ascii", 156, 157);
      const entry = { name, size };
      const target = type === "0" || type === "\0" ? open(entry) : null;
      file = { entry, remaining: size, out: target ? createWriteStream(target) : null, skip: padding(size).length };
    }
    if (finished) break;
  }
  if (file) throw new Error("Not a Canopy export: the archive ends part-way through a file");
  return entries;
}
