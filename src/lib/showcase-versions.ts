import { useEffect, useState } from "react"

import { parseShowcasePath } from "@/lib/showcase-routing"

// Used by ReleaseInfo, which needs the released-version list on every
// non-embedded, deployed URL. URLs are root-relative to wherever THIS
// deploy actually lives (derived from
// window.location.pathname via parseShowcasePath's hubPath), not hardcoded
// to the grist-widget-sdk monorepo's own showcase: a real scaffolded
// widget has its own versions.json and its own v<version>/ + dev/ dirs,
// and previously showed the monorepo's version history and links instead
// of its own (found live on a real scaffold's landing page).
function hubPath(): string {
  const path = parseShowcasePath(window.location.pathname).hubPath
  return path.endsWith("/") ? path : `${path}/`
}

export type ReleasedVersion = {
  version: string
  publishedAt: string
}

export function versionsUrl(): string {
  return `${hubPath()}versions.json`
}

export function devUrl(): string {
  return `${hubPath()}dev/`
}

export function versionUrl(version: string): string {
  return `${hubPath()}v${version}/`
}

export function useVersions() {
  const [versions, setVersions] = useState<ReleasedVersion[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(versionsUrl(), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: ReleasedVersion[]) => {
        if (!cancelled) setVersions(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { versions, error }
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}
