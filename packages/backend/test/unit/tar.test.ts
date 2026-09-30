/**
 * Unit — the export's tar (Phase 7.5 F)
 *
 * Hand-rolled, so the round trip is what matters: every file back byte for
 * byte, whatever the sizes and however the stream is chunked.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTar, tarStream } from "../../src/data/tar.js";

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function collect(gen: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of gen) parts.push(c);
  return Buffer.concat(parts);
}

/** Re-chunk a buffer into awkward pieces, as a network stream would. */
async function* chunked(buf: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

describe("tar", () => {
  it("round-trips files of any size, however the stream is cut", async () => {
    dir = await mkdtemp(join(tmpdir(), "canopy-tar-"));
    const files = {
      "empty.txt": Buffer.alloc(0),
      "exact.bin": Buffer.alloc(512, 7),
      "odd.bin": Buffer.from(Array.from({ length: 1234 }, (_, i) => i % 251)),
      "attachments/journal/a.jpg": Buffer.from("jpeg-ish"),
    };
    const archive = await collect(tarStream(Object.entries(files).map(([name, data]) => ({ name, size: data.length, data }))));

    for (const size of [1, 37, 512, 4096]) {
      const out = join(dir, `run-${size}`);
      const entries = await extractTar(chunked(archive, size), ({ name }) => join(dir!, `run-${size}-${name.replace(/\//g, "_")}`));
      expect(entries.map((e) => e.name)).toEqual(Object.keys(files));
      for (const [name, data] of Object.entries(files)) {
        expect(await readFile(join(dir, `run-${size}-${name.replace(/\//g, "_")}`))).toEqual(data);
      }
      expect(out).toBeTruthy();
    }
  });

  it("skips files it is not asked to keep", async () => {
    dir = await mkdtemp(join(tmpdir(), "canopy-tar-"));
    const archive = await collect(tarStream([
      { name: "keep", size: 3, data: Buffer.from("yes") },
      { name: "../evil", size: 2, data: Buffer.from("no") },
    ]));
    const entries = await extractTar(chunked(archive, 100), ({ name }) => (name === "keep" ? join(dir!, "keep") : null));
    expect(entries.map((e) => e.name)).toEqual(["keep", "../evil"]);
    expect(await readFile(join(dir, "keep"), "utf8")).toBe("yes");
  });

  it("refuses a damaged header", async () => {
    const archive = await collect(tarStream([{ name: "f", size: 1, data: Buffer.from("x") }]));
    archive[10] = 0x41;
    await expect(extractTar(chunked(archive, 512), () => null)).rejects.toThrow(/damaged/);
  });
});
