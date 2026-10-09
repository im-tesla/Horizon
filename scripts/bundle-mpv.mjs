import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL("mpv-manifest.json", import.meta.url), "utf8"),
);
const manifestHash = createHash("sha256")
  .update(JSON.stringify(manifest))
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(await readFile(new URL("extract-mpv.ps1", import.meta.url)))
  .update(
    await readFile(
      new URL("../resources/THIRD_PARTY_NOTICES.md", import.meta.url),
    ),
  )
  .digest("hex");
const hashFile = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");

async function download(spec, destination) {
  try {
    if ((await hashFile(destination)) === spec.sha256) return;
  } catch {}
  console.log(
    `Downloading pinned mpv ${manifest.version} (${path.basename(destination)})…`,
  );
  const response = await fetch(spec.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`mpv download returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== spec.sha256)
    throw new Error("mpv download checksum mismatch; refusing to package it.");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}

async function inventory(directory, prefix = "") {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (name === "bundle.json") continue;
    if (entry.isDirectory())
      Object.assign(
        files,
        await inventory(path.join(directory, entry.name), `${name}/`),
      );
    else if (entry.isFile())
      files[name] = await hashFile(path.join(directory, entry.name));
    else throw new Error(`Unexpected runtime symlink: ${name}`);
  }
  return files;
}

export async function verifyMpv(directory) {
  const record = JSON.parse(
    await readFile(path.join(directory, "bundle.json"), "utf8"),
  );
  if (
    record.manifest !== manifestHash ||
    record.platform !== `${process.platform}-${process.arch}`
  )
    throw new Error("mpv bundle version or platform mismatch.");
  const files = await inventory(directory);
  if (JSON.stringify(files) !== JSON.stringify(record.files))
    throw new Error(
      "mpv bundle is missing files or contains modified runtime files.",
    );
  const executable = path.join(
    directory,
    process.platform === "win32" ? "mpv.com" : "mpv",
  );
  const { stdout } = await run(executable, ["--version"], {
    windowsHide: true,
    timeout: 10000,
  });
  if (
    !stdout.includes(`mpv v${manifest.version}`) &&
    !stdout.includes(`mpv ${manifest.version}`)
  )
    throw new Error(
      `The bundled playback engine must be mpv ${manifest.version}.`,
    );
  for (const [option, required] of [
    ["--vo=help", "gpu-next"],
    ["--ao=help", process.platform === "win32" ? "wasapi" : "alsa"],
  ]) {
    const { stdout: help } = await run(executable, [option], {
      windowsHide: true,
      timeout: 10000,
    });
    if (!help.includes(required))
      throw new Error(`Bundled mpv is missing ${required} support.`);
  }
}

async function buildLinux(directory, source, cache) {
  const workspace = path.join(cache, "linux-source");
  await mkdir(workspace, { recursive: true });
  await run("tar", ["-xzf", source, "--strip-components=1", "-C", workspace]);
  const build = path.join(workspace, "build");
  const options = [
    "--buildtype=release",
    "--wrap-mode=nofallback",
    "--auto-features=disabled",
    "-Dlibmpv=false",
    "-Dbuild-date=false",
    "-Dlua=lua52",
    "-Dalsa=enabled",
    "-Dpulse=enabled",
    "-Dx11=enabled",
    "-Dwayland=enabled",
    "-Degl=enabled",
    "-Degl-x11=enabled",
    "-Degl-wayland=enabled",
    "-Dvulkan=enabled",
    "-Dvaapi=enabled",
    "-Dvaapi-x11=enabled",
    "-Dvaapi-wayland=enabled",
    "-Dlibarchive=disabled",
    "-Dlibavdevice=disabled",
    "-Dmanpage-build=disabled",
    "-Dhtml-build=disabled",
  ];
  console.log(
    "Building native Linux mpv with ALSA, PulseAudio, X11, Wayland and libass…",
  );
  // --wipe avoids retaining options from a previous build. No elevated build process.
  const existing = await readFile(
    path.join(build, "meson-private", "coredata.dat"),
  ).then(
    () => true,
    () => false,
  );
  await run(
    "meson",
    ["setup", ...(existing ? ["--wipe"] : []), build, workspace, ...options],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  await run("meson", ["compile", "-C", build, "-j", "2"], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const binary = path.join(build, "mpv");
  await mkdir(path.join(directory, "bin"), { recursive: true });
  await mkdir(path.join(directory, "lib"), { recursive: true });
  await mkdir(path.join(directory, "licenses"), { recursive: true });
  await copyFile(binary, path.join(directory, "bin", "mpv"));
  await chmod(path.join(directory, "bin", "mpv"), 0o755);

  // Leave the host C runtime, graphics loaders and drivers intact. Copy all other
  // linked libraries and their transitive closure, including nonstandard Pulse paths.
  const hostLibrary =
    /^(?:ld-linux|lib(?:c|m|dl|pthread|rt|resolv|nss_[\w]+)\.so|lib(?:GL|EGL|GLX|GLdispatch|OpenGL|gbm|drm\w*|vulkan|va(?:-x11|-drm|-wayland)?)\.so)/;
  const sources = new Map();
  async function collect(library) {
    const { stdout } = await run("ldd", [library]);
    if (stdout.includes("not found"))
      throw new Error(`Unresolved mpv library: ${stdout}`);
    for (const line of stdout.split("\n")) {
      const match = /^\s*(\S+)\s+=>\s+(\/\S+)/.exec(line);
      if (!match || hostLibrary.test(match[1]) || sources.has(match[1]))
        continue;
      sources.set(match[1], match[2]);
      await collect(match[2]);
    }
  }
  await collect(binary);
  const packages = new Map();
  for (const [name, original] of sources) {
    await copyFile(await realpath(original), path.join(directory, "lib", name));
    let stdout;
    try {
      ({ stdout } = await run("dpkg-query", ["-S", original]));
    } catch {
      ({ stdout } = await run("dpkg-query", ["-S", await realpath(original)]));
    }
    const owner = stdout.split(": ")[0].split("\n")[0];
    const { stdout: version } = await run("dpkg-query", [
      "-W",
      "-f=${source:Package}\t${source:Version}\n",
      owner,
    ]);
    packages.set(owner, version.trim());
    const copyright = path.join(
      "/usr/share/doc",
      owner.split(":")[0],
      "copyright",
    );
    await copyFile(
      copyright,
      path.join(directory, "licenses", `${owner.replaceAll(":", "-")}.txt`),
    );
  }
  await writeFile(
    path.join(directory, "runtime-packages.txt"),
    [...packages.values()].sort().join("\n") + "\n",
  );
  await writeFile(
    path.join(directory, "mpv"),
    `#!/bin/sh\nset -eu\nbase=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport LD_LIBRARY_PATH="$base/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"\nexec "$base/bin/mpv" "$@"\n`,
  );
  await chmod(path.join(directory, "mpv"), 0o755);
}

export async function prepareMpv(
  platform = process.platform,
  arch = process.arch,
) {
  if (
    platform !== process.platform ||
    arch !== process.arch ||
    arch !== "x64" ||
    !["win32", "linux"].includes(platform)
  )
    throw new Error("Build mpv on the matching x64 Windows or Linux host.");
  const target = `${platform}-${arch}`;
  const directory = path.join(root, "resources", "mpv", target);
  try {
    await verifyMpv(directory);
    console.log(`Bundled mpv ${manifest.version} verified (${target}).`);
    return directory;
  } catch {}
  const cache = path.join(root, ".horizon", "mpv-build", target);
  await mkdir(cache, { recursive: true });
  const source = path.join(cache, `mpv-${manifest.version}-source.tar.gz`);
  await download(manifest.source, source);
  // This fixed target is created by this script and never points outside resources/mpv.
  if (path.dirname(directory) !== path.join(root, "resources", "mpv"))
    throw new Error("Unsafe bundle target.");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  if (platform === "win32") {
    const archive = path.join(cache, "mpv-windows.zip");
    await download(manifest[target], archive);
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "scripts", "extract-mpv.ps1"),
        "-Archive",
        archive,
        "-Destination",
        directory,
      ],
      { windowsHide: true },
    );
  } else await buildLinux(directory, source, cache);
  const license = path.join(cache, "license");
  await mkdir(license, { recursive: true });
  await run("tar", [
    "-xzf",
    source,
    "--strip-components=1",
    "-C",
    license,
    `mpv-${manifest.source.commit}/LICENSE.GPL`,
  ]);
  await copyFile(
    path.join(license, "LICENSE.GPL"),
    path.join(directory, "LICENSE.GPL"),
  );
  await copyFile(
    source,
    path.join(directory, `mpv-${manifest.version}-source.tar.gz`),
  );
  await copyFile(
    path.join(root, "resources", "THIRD_PARTY_NOTICES.md"),
    path.join(directory, "THIRD_PARTY_NOTICES.md"),
  );
  await writeFile(
    path.join(directory, "bundle.json"),
    JSON.stringify(
      {
        manifest: manifestHash,
        platform: target,
        version: manifest.version,
        files: await inventory(directory),
      },
      null,
      2,
    ) + "\n",
  );
  await verifyMpv(directory);
  console.log(`Bundled mpv ${manifest.version} ready (${target}).`);
  return directory;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await prepareMpv();
