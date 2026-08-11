// Parses the deployed URL shape every channel of this template (or a real
// scaffolded widget) uses -- /latest/, /dev/, /v<version>/ -- so main.tsx and
// ReleaseInfo can label the current build using nothing but
// window.location.pathname. No router needed.
export type Channel =
  | { kind: "latest" }
  | { kind: "dev" }
  | { kind: "version"; version: string }

export function channelLabel(channel: Channel): string {
  switch (channel.kind) {
    case "latest":
      return "latest"
    case "dev":
      return "dev"
    case "version":
      return `v${channel.version}`
  }
}

/**
 * `hubPath` is the current path with a recognized trailing channel segment
 * stripped, e.g. "/grist-widget-sdk/template/latest/" ->
 * "/grist-widget-sdk/template/" -- used to build root-relative URLs
 * (versions.json, /dev/, /v<version>/) regardless of how deep this deploy's
 * own base path is (see showcase-versions.ts).
 *
 * `channel` always resolves to something: `scripts/deploy.mjs` places the
 * same build at the bare deployed root as at `/latest/`, so a path with no
 * recognized suffix (the root itself, or a local `pnpm dev` server) defaults
 * to `{ kind: "latest" }` -- that's genuinely what's there.
 */
export function parseShowcasePath(pathname: string): {
  channel: Channel
  hubPath: string
} {
  const trimmed = pathname.replace(/\/+$/, "")
  const segments = trimmed.split("/")
  const last = segments[segments.length - 1] ?? ""

  let channel: Channel = { kind: "latest" }
  let matchedSuffix = false
  if (last === "latest") {
    channel = { kind: "latest" }
    matchedSuffix = true
  } else if (last === "dev") {
    channel = { kind: "dev" }
    matchedSuffix = true
  } else {
    const match = /^v(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(last)
    if (match) {
      channel = { kind: "version", version: match[1] }
      matchedSuffix = true
    }
  }

  const hubPath = matchedSuffix ? segments.slice(0, -1).join("/") + "/" : pathname
  return { channel, hubPath }
}
