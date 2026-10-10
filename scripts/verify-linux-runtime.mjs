import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Inspect undefined symbols, not the versions an ELF library itself exports.
export function newerGlibcRequirements(symbols, baseline = "2.35") {
  const [major, minor] = baseline.split(".").map(Number);
  return [
    ...new Set(
      symbols
        .split("\n")
        .filter((line) => /\bUND\b/.test(line))
        .flatMap((line) => [...line.matchAll(/@GLIBC_(\d+)\.(\d+)/g)])
        .filter(
          (match) =>
            Number(match[1]) > major ||
            (Number(match[1]) === major && Number(match[2]) > minor),
        )
        .map((match) => `${match[1]}.${match[2]}`),
    ),
  ];
}

export async function verifyLinuxRuntime(directory, baseline = "2.35") {
  let checked = 0;
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const handle = await open(file, "r");
        const magic = Buffer.alloc(4);
        try {
          await handle.read(magic, 0, 4, 0);
        } finally {
          await handle.close();
        }
        if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) continue;
        const { stdout } = await run(
          "readelf",
          ["--wide", "--dyn-syms", file],
          {
            maxBuffer: 16 * 1024 * 1024,
          },
        );
        const unsupported = newerGlibcRequirements(stdout, baseline);
        if (unsupported.length)
          throw new Error(
            `${path.relative(directory, file)} requires GLIBC_${unsupported.join(", GLIBC_")}; Linux packages must support glibc ${baseline}. Build on Ubuntu 22.04.`,
          );
        checked++;
      }
    }
  }
  await visit(directory);
  if (!checked) throw new Error("No Linux runtime binaries were found.");
  console.log(`Verified ${checked} ELF files against glibc ${baseline}.`);
}
