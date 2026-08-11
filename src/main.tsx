import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { GristBoundary, GristWidgetProvider } from "grist-widget-sdk"

import { GristSdkAlerts } from "@/components/grist-sdk-alerts"
import { GristStatusChip } from "@/components/grist-status-chip"
import { LocalDevNotice } from "@/components/local-dev-notice"
import { ReleaseInfo } from "@/components/release-info"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { parseShowcasePath } from "@/lib/showcase-routing"
import "./index.css"
import App, { GRIST_OPTIONS } from "./App.tsx"

// A Grist custom widget only ever runs embedded in Grist's own iframe.
// Opened directly in a browser tab (window.self === window.top), there's no
// Grist to connect to -- two different non-embedded experiences, told apart
// by import.meta.env.DEV (a real embed always wins over either, checked
// first):
//   - `pnpm dev` (DEV) -> LocalDevNotice: a bare shell pointing at the real
//     verification loop (push to `dev`, open it in a real Grist doc) --
//     deliberately not a live/seeded preview. An emulator can't guarantee
//     parity with real Grist, so pretending otherwise here would teach the
//     wrong lesson; `pnpm test` (renderWithGrist, headless) is the loop
//     worth trusting locally. See AGENTS.md.
//   - any built/deployed URL (root, /latest/, /dev/, /v<version>/, all
//     carrying the same build per scripts/deploy.mjs) -> ReleaseInfo: which
//     build this is, chips to jump to any other version/channel, and a
//     copy-this-URL helper for pasting into Grist's custom widget field.
const isEmbedded = window.self !== window.top
const { channel } = parseShowcasePath(window.location.pathname)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      {isEmbedded ? (
        <GristWidgetProvider options={GRIST_OPTIONS}>
          <GristStatusChip />
          <GristBoundary
            gate={GRIST_OPTIONS.columns?.length ? "canRender" : "ready"}
          >
            <div className="min-h-full w-full bg-background text-foreground">
              <GristSdkAlerts>
                <App />
              </GristSdkAlerts>
            </div>
          </GristBoundary>
        </GristWidgetProvider>
      ) : import.meta.env.DEV ? (
        <div className="min-h-full w-full bg-background text-foreground">
          <LocalDevNotice />
        </div>
      ) : (
        <div className="min-h-full w-full bg-background text-foreground">
          <ReleaseInfo channel={channel} />
        </div>
      )}
    </ThemeProvider>
  </StrictMode>
)
