import { readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export function releaseAssets(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
    throw new Error("Invalid stable release version.");
  const windows = `Horizon-${version}-windows-x64.exe`;
  const appImage = `Horizon-${version}-linux-x64.AppImage`;
  const deb = `Horizon-${version}-linux-x64.deb`;
  const required = [
    windows,
    `Horizon-${version}-windows-x64-portable.exe`,
    `${windows}.blockmap`,
    appImage,
    deb,
    `horizon-server-${version}-linux-x64.tar.gz`,
    "latest.yml",
    "latest-linux.yml",
  ];
  const names = readdirSync(directory);
  for (const name of required) {
    if (
      !names.includes(name) ||
      !statSync(path.join(directory, name)).isFile() ||
      statSync(path.join(directory, name)).size === 0
    )
      throw new Error(`Required release asset is missing or empty: ${name}`);
  }
  for (const [manifestName, installers] of [
    ["latest.yml", [windows]],
    ["latest-linux.yml", [appImage, deb]],
  ]) {
    const manifest = readFileSync(path.join(directory, manifestName), "utf8");
    if (
      !new RegExp(
        `^version: ['\"]?${version.replaceAll(".", "\\.")}['\"]?\\s*$`,
        "m",
      ).test(manifest)
    )
      throw new Error(`${manifestName} does not match release ${version}.`);
    for (const installer of installers) {
      const checksum = createHash("sha512")
        .update(readFileSync(path.join(directory, installer)))
        .digest("base64");
      if (!manifest.includes(installer) || !manifest.includes(checksum))
        throw new Error(
          `${manifestName} does not describe the packaged ${installer}.`,
        );
    }
  }
  return names
    .filter(
      (name) =>
        required.includes(name) ||
        (name.startsWith(`Horizon-${version}-`) && name.endsWith(".blockmap")),
    )
    .sort()
    .map((name) => path.join(directory, name));
}
