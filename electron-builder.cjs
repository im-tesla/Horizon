const repository =
  process.env.GITHUB_REPOSITORY ||
  require("./package.json")
    .repository.url.replace("https://github.com/", "")
    .replace(/\.git$/, "");
if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
  throw new Error("GITHUB_REPOSITORY must use owner/repository format.");
const [owner, repo] = repository ? repository.split("/") : [];
module.exports = {
  appId: "org.horizonstream.desktop",
  productName: "Horizon",
  extraMetadata: { horizonRepository: repository },
  directories: { output: "release", buildResources: "resources" },
  files: ["dist/desktop/**", "dist/renderer/**", "package.json", "!**/.env*"],
  asar: true,
  extraResources: [
    { from: "resources/mpv/${platform}-${arch}", to: "mpv" },
    { from: "resources/THIRD_PARTY_NOTICES.md", to: "THIRD_PARTY_NOTICES.md" },
    { from: "src/renderer/assets/Inter-LICENSE.txt", to: "Inter-LICENSE.txt" },
    { from: "resources/fonts", to: "fonts" },
    { from: "resources/player", to: "player" },
    { from: "LICENSE", to: "Horizon-LICENSE.txt" },
  ],
  beforePack: async (context) => {
    const { prepareMpv } = await import("./scripts/bundle-mpv.mjs");
    await prepareMpv(context.electronPlatformName, "x64");
  },
  afterPack: async (context) => {
    const { verifyMpv } = await import("./scripts/bundle-mpv.mjs");
    await verifyMpv(
      require("node:path").join(context.appOutDir, "resources", "mpv"),
    );
  },
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "portable", arch: ["x64"] },
    ],
    icon: "resources/icon.ico",
    artifactName: "Horizon-${version}-windows-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
  },
  portable: {
    artifactName: "Horizon-${version}-windows-${arch}-portable.${ext}",
  },
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
    ],
    icon: "resources/icon.png",
    category: "AudioVideo",
    maintainer: "Horizon contributors",
    artifactName: "Horizon-${version}-linux-${arch}.${ext}",
    executableName: "horizon",
    desktop: {
      entry: {
        StartupWMClass: "Horizon",
        Comment: "Stream original-quality movies and series with mpv",
      },
    },
  },
  deb: {
    depends: [
      "libc6 (>= 2.39)",
      "libgtk-3-0",
      "libnss3",
      "libxss1",
      "libxtst6",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0",
      "libx11-6",
      "libegl1",
      "libgl1",
      "libgbm1",
      "libdrm2",
      "libvulkan1",
      "libva2",
      "libva-x11-2",
      "libva-wayland2",
      "libasound2-data",
    ],
  },
  ...(owner && repo
    ? { publish: [{ provider: "github", owner, repo, releaseType: "release" }] }
    : {}),
};
