import { useEffect, useState } from "react"
import { useAmbientGristHandshake, type GristWidgetSnapshot } from "grist-widget-sdk/advanced"

import { deriveDisplayStatus, type HandshakeDisplayStatus } from "@/lib/grist-handshake-status"
import { cn } from "@/lib/utils"

// Fixed, approximate countdown shown while retrying -- not a mirror of the
// SDK's actual internal poll backoff (an implementation detail, not part of
// the public API surface, which ramps up from ~200ms before settling into a
// steady cadence). Most production widgets connect in under a second per the
// SDK's own docs, so a visibly "retrying" chip is already in that settled
// long tail -- this just picks the same round number as a display countdown.
const RETRY_COUNTDOWN_SECONDS = 5

function useRetryCountdown(attempts: number, active: boolean) {
  const [state, setState] = useState({ attempts, secondsLeft: RETRY_COUNTDOWN_SECONDS })

  // Reset the countdown the moment a new retry attempt begins -- an
  // "adjust state during render" pattern, not a setState-in-effect (which
  // the linter flags): https://react.dev/learn/you-might-not-need-an-effect
  if (active && state.attempts !== attempts) {
    setState({ attempts, secondsLeft: RETRY_COUNTDOWN_SECONDS })
  }

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setState((s) => ({ ...s, secondsLeft: s.secondsLeft > 0 ? s.secondsLeft - 1 : 0 }))
    }, 1000)
    return () => clearInterval(id)
  }, [attempts, active])

  return state.secondsLeft
}

function StatusDot({ pulsing, className }: { pulsing: boolean; className: string }) {
  return (
    <span className="relative flex size-2">
      {pulsing && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            className,
          )}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", className)} />
    </span>
  )
}

/** Pure render of a display status. */
function ChipVisual({ display, secondsLeft }: { display: HandshakeDisplayStatus; secondsLeft: number }) {
  switch (display.kind) {
    case "connecting":
      return (
        <>
          <StatusDot pulsing className="bg-amber-500" />
          Connecting to Grist
        </>
      )
    case "retrying":
      return (
        <>
          <StatusDot pulsing className="bg-amber-500" />
          Retry Grist connection in {secondsLeft}s
        </>
      )
    case "connected":
      return (
        <>
          <StatusDot pulsing={false} className="bg-emerald-500" />
          Grist connected
        </>
      )
    case "unavailable":
      return (
        <>
          <StatusDot pulsing={false} className="bg-destructive" />
          Grist unavailable
        </>
      )
  }
}

function RealChipContents({ snapshot }: { snapshot: GristWidgetSnapshot }) {
  const display = deriveDisplayStatus(snapshot.lifecycle)
  const retryAttempts = display.kind === "retrying" ? display.attempts : 0
  const secondsLeft = useRetryCountdown(retryAttempts, display.kind === "retrying")
  return <ChipVisual display={display} secondsLeft={secondsLeft} />
}

/**
 * Small pill showing live Grist handshake status while actually embedded in
 * Grist. Must be mounted *inside* `<GristWidgetProvider>` -- it only observes
 * that provider's own handshake manager (`useAmbientGristHandshake()`,
 * `grist-widget-sdk/advanced`) and never mounts its own, so it can't ever run
 * a second, competing `grist.ready()` call. Renders nothing outside a
 * provider.
 */
export function GristStatusChip({ className }: { className?: string }) {
  const handshake = useAmbientGristHandshake()
  if (!handshake) return null
  return (
    <div className="pointer-events-none fixed top-2 right-2 z-50">
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur",
          className,
        )}
      >
        <RealChipContents snapshot={handshake.snapshot} />
      </div>
    </div>
  )
}
