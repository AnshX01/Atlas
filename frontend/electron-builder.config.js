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
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      { target: "zip", arch: ["arm64", "x64"] },
    ],
    icon: "public/icon.png",
    darkModeSupport: true,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    identity: null,
    artifactName: "${productName}-${version}-mac-${arch}.${ext}",
  },
  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      { target: "zip", arch: ["x64"] },
    ],
    icon: "public/icon.png",
    artifactName: "${productName}-Setup-${version}.${ext}",
  },
  linux: {
    target: [
      { target: "AppImage", arch: ["x64"] },
      { target: "deb", arch: ["x64"] },
      { target: "tar.gz", arch: ["x64"] },
    ],
    icon: "public/icon.png",
    category: "Office",
    artifactName: "${productName}-${version}-linux-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: "${productName}-Setup-${version}.${ext}",
  },
};
