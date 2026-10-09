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
      start: "node horizon-server.mjs start",
      "start:server": "node horizon-server.mjs start",
      setup: "node scripts/setup.mjs",
      update: "node horizon-server.mjs update",
      "update:check": "node horizon-server.mjs check",
      rollback: "node horizon-server.mjs rollback",
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
  await copyFile(
    path.join(root, "scripts/server-manager.mjs"),
    path.join(directory, "horizon-server.mjs"),
  );
  await copyFile(
    path.join(root, "scripts/server-manager.mjs"),
    path.join(root, "release-assets/horizon-server.mjs"),
  );
  await writeFile(
    path.join(directory, "README.md"),
    `# Horizon server ${version}\n\nRequires Node.js 22.12 or newer and ffprobe. On Ubuntu: \`sudo apt install ffmpeg\`.\n\n\`\`\`sh\nnpm run setup\n# Edit .env to choose your media folder and network settings.\nnpm start\n\`\`\`\n\nKeep this folder as your permanent server folder. Updates download only application files:\n\n\`\`\`sh\nnpm run update:check\nnpm run update\n# Restore the previous version if needed:\nnpm run rollback\n\`\`\`\n\nA running server restarts after an update. Media, .env, and the library cache stay in place, including relative paths inside this folder. Previous application versions are kept under .horizon/releases. No compilation or npm install is needed.\n\nFor automatic startup, see deploy/horizon.service.\nFull setup and older-installation upgrades: https://github.com/im-tesla/Horizon/blob/main/docs/SERVER_SETUP.md\n`,
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
