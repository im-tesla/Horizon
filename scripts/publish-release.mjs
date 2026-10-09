import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { releaseAssets } from "./release-assets.mjs";
const version = process.env.RELEASE_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
  throw new Error("Invalid release version.");
const tag = `v${version}`;
const files = releaseAssets("release-assets", version);
writeFileSync(
  "release-assets/SHA256SUMS",
  files
    .map(
      (file) =>
        `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${file.replaceAll("\\", "/").slice("release-assets/".length)}`,
    )
    .join("\n") + "\n",
);
files.push("release-assets/SHA256SUMS");
writeFileSync(
  "release-assets/notes.md",
  `Horizon ${version}\n\nWindows: install the .exe, or run the -portable.exe. Linux: use the AppImage or install the .deb. Installers and Linux packages support in-app updates; portable Windows builds check for new releases and provide a download button. Every desktop package includes mpv and its runtime libraries. Linux desktop builds require glibc 2.39 or newer (Ubuntu 24.04 or equivalent).\n\nServer: extract horizon-server-${version}-linux-x64.tar.gz, install Node.js 22.12+ and ffprobe, run npm run setup, edit .env, and run npm start. The archive contains the compiled server and its runtime dependencies. It runs natively on Ubuntu without containers or a build step and streams original files without transcoding.\n\nClient history and resume positions are stored locally. See README.md for setup. SHA256SUMS covers every release asset.\n`,
);
try {
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--target",
      process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "main",
      "--title",
      `Horizon ${version}`,
      "--draft",
      "--notes-file",
      "release-assets/notes.md",
      ...files,
    ],
    { stdio: "inherit" },
  );
} catch (error) {
  const existing = JSON.parse(
    execFileSync("gh", ["release", "view", tag, "--json", "isDraft"], {
      encoding: "utf8",
    }),
  );
  if (!existing.isDraft) throw error;
  execFileSync("gh", ["release", "upload", tag, ...files, "--clobber"], {
    stdio: "inherit",
  });
}
execFileSync(
  "gh",
  [
    "release",
    "edit",
    tag,
    "--draft=false",
    "--latest",
    "--title",
    `Horizon ${version}`,
    "--notes-file",
    "release-assets/notes.md",
  ],
  {
    stdio: "inherit",
  },
);
