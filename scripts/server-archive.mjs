import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = JSON.parse(await readFile("package.json", "utf8"));
const version = process.env.RELEASE_VERSION ?? source.version;
if (!/^\d+\.\d+\.\d+$/.test(version) || version !== source.version)
  throw new Error(
    "The server release must match package.json's stable version.",
  );
if (!process.env.npm_execpath)
  throw new Error("Run npm run package:server to assemble the server release.");
await mkdir(".horizon", { recursive: true });
await mkdir("release-assets", { recursive: true });
const staging = await mkdtemp(path.join(root, ".horizon", "server-release-"));
const directory = path.join(staging, `horizon-server-${version}`);
try {
  await mkdir(path.join(directory, "dist", "server"), { recursive: true });
  await mkdir(path.join(directory, "scripts"));
  await mkdir(path.join(directory, "deploy"));
  const runtime = {
    name: "horizon-server",
    version,
    private: true,
    type: "module",
    license: "MIT",
    engines: source.engines,
    scripts: {
      start: "node dist/server/index.mjs",
      "start:server": "node dist/server/index.mjs",
      setup: "node scripts/setup.mjs",
    },
    dependencies: Object.fromEntries(
      ["@fastify/rate-limit", "chokidar", "dotenv", "fastify", "zod"].map(
        (name) => [name, source.dependencies[name]],
      ),
    ),
  };
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  lock.name = runtime.name;
  lock.version = version;
  lock.packages[""] = {
    name: runtime.name,
    version,
    license: runtime.license,
    engines: runtime.engines,
    dependencies: runtime.dependencies,
  };
  await writeFile(
    path.join(directory, "package.json"),
    JSON.stringify(runtime, null, 2) + "\n",
  );
  await writeFile(
    path.join(directory, "package-lock.json"),
    JSON.stringify(lock, null, 2) + "\n",
  );
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "install",
      "--package-lock-only",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  for (const file of [
    "dist/server/index.mjs",
    "scripts/setup.mjs",
    ".env.example",
    "deploy/horizon.service",
    "deploy/Caddyfile",
    "LICENSE",
  ])
    await copyFile(path.join(root, file), path.join(directory, file));
  await writeFile(
    path.join(directory, "README.md"),
    `# Horizon server ${version}\n\nPrebuilt native server. Requires Node.js 22.12 or newer and ffprobe.\nOn Ubuntu, install ffprobe with \`sudo apt install ffmpeg\`.\n\n\`\`\`sh\nnpm run setup\n# Edit .env: token, media directory, host, port, and data directory.\nnpm start\n\`\`\`\n\nRuntime dependencies are included; no npm install or compilation is needed.\nFor systemd, see deploy/horizon.service. Set HORIZON_DATA_DIR=/var/lib/horizon\nand put media outside /home when using ProtectHome=true. Configuration belongs\nin /etc/horizon.env; the example service runs from /opt/horizon.\n\nServer upgrades: stop the service, replace application files with the new release,\npreserve .env and your media/data directories, and restart the service.\n\nFull documentation: https://github.com/im-tesla/Horizon#run-the-linux-server\n`,
  );
  const output = path.join(
    root,
    "release-assets",
    `horizon-server-${version}-linux-x64.tar.gz`,
  );
  execFileSync(
    "tar",
    ["-czf", output, "-C", staging, path.basename(directory)],
    { stdio: "inherit" },
  );
  console.log(`Prebuilt server release: ${path.relative(root, output)}`);
} finally {
  if (path.dirname(staging) !== path.join(root, ".horizon"))
    throw new Error("Unsafe server staging directory.");
  await rm(staging, { recursive: true, force: true });
}
