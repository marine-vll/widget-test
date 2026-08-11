import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { channelLabel, type Channel } from "@/lib/showcase-routing"
import { devUrl, formatDate, useVersions, versionUrl } from "@/lib/showcase-versions"
import { cn } from "@/lib/utils"

// Shown on every non-embedded, built/deployed URL of this widget -- root,
// /latest/, /dev/, /v<version>/, all carrying the same build per
// scripts/deploy.mjs's plan() -- when opened outside Grist. Local `pnpm dev`
// renders `LocalDevNotice` instead (see src/main.tsx): this component's
// "paste this URL into Grist" instruction only makes sense for a real,
// publicly reachable URL, never a bare localhost one.
function VersionChips({ current }: { current: Channel }) {
  const { versions } = useVersions()

  function chipClass(active: boolean) {
    return cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    )
  }

  return (
    <div className="mb-8 flex flex-wrap justify-center gap-2">
      {versions !== null && versions.length > 0 && (
        <a
          href={versionUrl(versions[0].version)}
          title={formatDate(versions[0].publishedAt)}
          className={chipClass(
            current.kind === "version" && current.version === versions[0].version,
          )}
        >
          latest
        </a>
      )}
      <a href={devUrl()} className={chipClass(current.kind === "dev")}>
        dev
      </a>
      {versions?.map((v) => (
        <a
          key={v.version}
          href={versionUrl(v.version)}
          title={formatDate(v.publishedAt)}
          className={chipClass(
            current.kind === "version" && current.version === v.version,
          )}
        >
          v{v.version}
        </a>
      ))}
    </div>
  )
}

export function ReleaseInfo({ channel }: { channel: Channel }) {
  const [copied, setCopied] = useState(false)
  const url = window.location.href

  function copyUrl() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <p className="mb-2 text-center text-sm font-medium text-muted-foreground">
        grist-widget-template · {channelLabel(channel)}
      </p>
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight">
        Grist isn't loaded here
      </h1>
      <p className="mx-auto mt-3 mb-8 max-w-sm text-center text-sm text-muted-foreground">
        You're viewing the <span className="font-mono">{channelLabel(channel)}</span>{" "}
        build directly, outside of Grist. Hover a chip below to see when it
        shipped.
      </p>

      <VersionChips current={channel} />

      <Card>
        <CardHeader>
          <CardTitle>Use this as a Grist custom widget</CardTitle>
          <CardDescription>
            Paste this URL into Grist's custom widget URL field.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button type="button" onClick={copyUrl}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
