export interface UpdateAsset {
  name: string
  url: string
  size: number
  contentType: string | null
  digest: string | null
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  available: boolean
  releaseName: string
  releaseNotes: string
  releaseUrl: string
  publishedAt: string | null
  asset: UpdateAsset | null
}

export interface UpdateDownloadResult {
  version: string
  path: string
  assetName: string
  opened: boolean
}

export interface UpdateProgress {
  version: string
  downloadedBytes: number
  totalBytes: number
}
