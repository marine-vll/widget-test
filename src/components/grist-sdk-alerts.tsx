import { useMemo, type ReactNode } from "react"
import { AlertTriangle, Link2 } from "lucide-react"

import {
  useGristSdkAlertDescriptors,
  useGristOptional,
  type GetGristSdkAlertDescriptorsOptions,
  type GristSdkAlertSeverity,
  type UseGristResult,
} from "grist-widget-sdk"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

export type GristSdkAlertsProps = {
  /** Defaults to the nearest `GristWidgetProvider`. */
  widget?: UseGristResult
  children: ReactNode
  className?: string
}

const GRIST_ALERT_OPTIONS: GetGristSdkAlertDescriptorsOptions = {
  sectionNotLinkedHint:
    "In Grist, select this widget section on the page, then use Link to connect a table, card, or chart view as the selector.",
}

function alertSeverityClass(severity: GristSdkAlertSeverity): string | undefined {
  switch (severity) {
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
    case "info":
      return "border-muted-foreground/30 bg-muted/50"
    default:
      return undefined
  }
}

/**
 * Maps {@link getGristSdkAlertDescriptors} from `grist-widget-sdk` to
 * shadcn {@link Alert} (styling follows this app’s `components.json`).
 */
export function GristSdkAlerts({ widget, children, className }: GristSdkAlertsProps) {
  const fromContext = useGristOptional()
  const w = widget ?? fromContext

  if (!w) {
    throw new Error(
      "GristSdkAlerts requires a `widget` prop or <GristWidgetProvider>"
    )
  }

  const alertOptions = useMemo(() => GRIST_ALERT_OPTIONS, [])
  const alerts = useGristSdkAlertDescriptors(w, alertOptions)

  if (alerts.length === 0) {
    return <>{children}</>
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {alerts.map((a) => (
        <Alert
          key={a.id}
          role={a.ariaRole}
          variant={a.severity === "error" ? "destructive" : "default"}
          className={alertSeverityClass(a.severity)}
        >
          {a.kind === "section-not-linked" || a.kind === "source-not-wired" ? (
            <Link2 className="size-4" aria-hidden />
          ) : (
            <AlertTriangle className="size-4" aria-hidden />
          )}
          <AlertTitle>{a.title}</AlertTitle>
          <AlertDescription>{a.message}</AlertDescription>
        </Alert>
      ))}
      {children}
    </div>
  )
}
