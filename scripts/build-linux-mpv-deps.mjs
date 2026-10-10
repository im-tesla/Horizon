import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function buildLinuxDependencies(
  cache,
  directory,
  specs,
  download,
) {
  const prefix = path.join(cache, "prefix");
  const tools = path.resolve(".horizon/mpv-tools/bin");
  const env = {
    ...process.env,
    PATH: `${tools}:${process.env.PATH}`,
    PKG_CONFIG_PATH: `${prefix}/lib/pkgconfig`,
    LD_LIBRARY_PATH: `${prefix}/lib`,
  };
  const sources = {};
  await mkdir(path.join(directory, "sources"), { recursive: true });
  await mkdir(path.join(directory, "licenses"), { recursive: true });
  for (const [name, spec] of Object.entries(specs)) {
    const archive = path.join(cache, spec.archive);
    await download(spec, archive);
    const source = ["ffmpeg", "libplacebo"].includes(name)
      ? path.join(cache, name)
      : path.join(cache, "libplacebo", "3rdparty", name);
    await mkdir(source, { recursive: true });
    await run("tar", ["-xf", archive, "--strip-components=1", "-C", source]);
    await copyFile(archive, path.join(directory, "sources", spec.archive));
    sources[name] = source;
  }
  console.log("Building pinned FFmpeg libraries for Ubuntu 22.04…");
  await run(
    path.join(sources.ffmpeg, "configure"),
    [
      `--prefix=${prefix}`,
      "--disable-programs",
      "--disable-doc",
      "--disable-debug",
      "--disable-static",
      "--enable-shared",
      "--enable-pic",
      "--disable-autodetect",
      "--disable-encoders",
      "--disable-avdevice",
      "--enable-gnutls",
      "--enable-libdav1d",
      "--enable-vaapi",
      "--enable-zlib",
      "--enable-bzlib",
      "--enable-lzma",
    ],
    { cwd: sources.ffmpeg, env, maxBuffer: 8 * 1024 * 1024 },
  );
  await run("make", ["-j2"], {
    cwd: sources.ffmpeg,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  await run("make", ["install"], {
    cwd: sources.ffmpeg,
    env,
    maxBuffer: 8 * 1024 * 1024,
  });

  console.log("Building pinned libplacebo with OpenGL for embedded playback…");
  const build = path.join(sources.libplacebo, "build");
  const existing = await readFile(
    path.join(build, "meson-private", "coredata.dat"),
  ).then(
    () => true,
    () => false,
  );
  await run(
    "meson",
    [
      "setup",
      ...(existing ? ["--wipe"] : []),
      build,
      sources.libplacebo,
      `--prefix=${prefix}`,
      "--libdir=lib",
      "--buildtype=release",
      "--wrap-mode=nofallback",
      "--auto-features=disabled",
      "-Ddefault_library=shared",
      "-Dopengl=enabled",
      "-Dvulkan=disabled",
      "-Dgl-proc-addr=enabled",
      "-Dvk-proc-addr=disabled",
      "-Dglslang=disabled",
      "-Dshaderc=disabled",
      "-Dlcms=enabled",
      "-Ddemos=false",
      "-Dtests=false",
    ],
    { env, maxBuffer: 8 * 1024 * 1024 },
  );
  await run("meson", ["compile", "-C", build, "-j", "2"], {
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
  await run("meson", ["install", "-C", build], {
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
  for (const [name, license] of [
    ["ffmpeg", "COPYING.LGPLv2.1"],
    ["libplacebo", "LICENSE"],
  ])
    await copyFile(
      path.join(sources[name], license),
      path.join(directory, "licenses", `${name}.txt`),
    );
  await writeFile(
    path.join(directory, "sources", "README.txt"),
    "Pinned sources for the Linux playback libraries and their submodules.\n" +
      "Reproduction: Horizon scripts/install-mpv-build-deps.sh, build-linux-mpv-deps.mjs and bundle-mpv.mjs on Ubuntu 22.04.\n",
  );
  return { prefix, env };
}
