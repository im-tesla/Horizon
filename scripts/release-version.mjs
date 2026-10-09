import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("Release versions must use stable major.minor.patch format.");
let previous;
let before = "HEAD^";
try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (/^[0-9a-f]{40}$/.test(event.before) && !/^0+$/.test(event.before))
    before = event.before;
} catch {}
try {
  previous = JSON.parse(
    execFileSync("git", ["show", `${before}:package.json`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  ).version;
} catch {}
let tagged = true;
let commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
try {
  execFileSync("git", ["rev-parse", "--verify", `refs/tags/v${version}`], {
    stdio: "ignore",
  });
} catch {
  tagged = false;
}
let published = tagged;
if (tagged && process.env.GH_TOKEN && process.env.GITHUB_REPOSITORY) {
  const response = await fetch(
    `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/v${version}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) published = false;
  else if (response.ok) published = !(await response.json()).draft;
  else
    throw new Error(
      `Could not verify the existing release (${response.status}).`,
    );
  if (!published)
    commit = execFileSync("git", ["rev-list", "-n", "1", `v${version}`], {
      encoding: "utf8",
    }).trim();
}
const release =
  !published &&
  (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
    previous !== version);
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nrelease=${release}\ncommit=${commit}\n`,
  );
console.log(
  `Version ${version}; release ${release ? "needed" : "already published or unchanged"}.`,
);
