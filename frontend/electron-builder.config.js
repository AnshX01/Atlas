module.exports = {
  appId: "app.atlas.personal-command-center",
  productName: "Atlas",
  copyright: "Copyright © 2026 Atlas",
  directories: {
    output: "release",
    buildResources: "resources",
  },
  files: [
    "out/**/*",
    "dist-electron/**/*",
  ],
  mac: {
    category: "public.app-category.productivity",
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Office",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  publish: {
    provider: "github",
    releaseType: "draft",
  },
};
