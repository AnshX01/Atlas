module.exports = {
  appId: "app.atlas.personal-command-center",
  productName: "Atlas",
  copyright: "Copyright © 2026 Atlas",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: [
    "out/**/*",
    "dist-electron/**/*",
    "public/icon.png",
    "public/logo.png",
  ],
  icon: "public/icon.png",
  mac: {
    category: "public.app-category.productivity",
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    icon: "public/icon.png",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "public/icon.png",
  },
  linux: {
    target: ["AppImage", "deb"],
    icon: "public/icon.png",
    category: "Office",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "Atlas Setup.exe",
  },
  publish: {
    provider: "github",
    releaseType: "draft",
  },
};
