import type { GristLifecycle } from "grist-widget-sdk/advanced"

// Projects the SDK's full GristLifecycle (advanced API, grist-widget-sdk/advanced)
// down to the handful of states a small status chip needs to show.
export type HandshakeDisplayStatus =
  | { kind: "connecting" }
  | { kind: "retrying"; attempts: number }
  | { kind: "connected" }
  | { kind: "unavailable" }

export function deriveDisplayStatus(lifecycle: GristLifecycle): HandshakeDisplayStatus {
  switch (lifecycle.phase) {
    case "idle":
      return { kind: "connecting" }
    case "detecting":
      return lifecycle.attempts > 0
        ? { kind: "retrying", attempts: lifecycle.attempts }
        : { kind: "connecting" }
    case "negotiating":
      return { kind: "connecting" }
    case "online":
      return { kind: "connected" }
    case "terminated":
      return { kind: "unavailable" }
  }
}
