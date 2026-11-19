import { AppArchive } from "../src/app-archive"

// The vendored runtime ships without a web UI bundle, so the archive stays empty.
// electron-builder packs the desktop renderer separately.
export async function buildAppArchive(_channel: string, _version: string, _options?: { skipBuild?: boolean }) {
  return AppArchive.encode([])
}
