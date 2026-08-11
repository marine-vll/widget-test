import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useGrist,
  useWidgetMetadata,
  type UseGristOptions,
  type UseGristResult,
} from "grist-widget-sdk"

import type { TaskMapped, TaskRow } from "./grist-types.example"

export const GRIST_OPTIONS: UseGristOptions = {
  requiredAccess: "full",
  columns: [
    { name: "title", type: "Text" },
    { name: "done", type: "Bool" },
  ],
}

export const WIDGET_METADATA = {
  title: "Grist Widget Template",
  description: "Edit the selected row's title and mark it done.",
} as const

type TemplateGrist = UseGristResult<TaskRow, TaskMapped>

function GristSelectionDebug({ w }: { w: TemplateGrist }) {
  return (
    <details className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">
        Grist selection debug
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
        <dt className="text-muted-foreground">status</dt>
        <dd>{w.status}</dd>
        <dt className="text-muted-foreground">mode</dt>
        <dd>{w.mode}</dd>
        <dt className="text-muted-foreground">isReady</dt>
        <dd>{String(w.isReady)}</dd>
        <dt className="text-muted-foreground">record.id</dt>
        <dd>{w.record?.id != null ? String(w.record.id) : "—"}</dd>
      </dl>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/80 p-2">
        {w.record != null
          ? JSON.stringify(w.record, null, 2)
          : "null (no row selected)"}
      </pre>
    </details>
  )
}

type Draft = { title: string; done: boolean }

function readDraft(mapped: TaskMapped | null): Draft {
  return { title: mapped?.title ?? "", done: mapped?.done ?? false }
}

function RowEditor({ w }: { w: TemplateGrist }) {
  const [draft, setDraft] = useState<Draft>(() => readDraft(w.mappedRecord))
  const [saveError, setSaveError] = useState<string | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!w.record) return
    setSaveError(null)
    try {
      await w.table.update({
        id: w.record.id,
        fields: w.mapBack({ title: draft.title, done: draft.done }),
      })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4 p-6 text-sm">
      <header>
        <h1 className="font-medium">Row #{String(w.record!.id)}</h1>
        <p className="text-muted-foreground">
          Edit the fields, then save back to Grist via{" "}
          <code className="rounded bg-muted px-1 text-xs">table.update</code>.
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Title
        </span>
        <Input
          required
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={draft.done}
          onChange={(e) => setDraft((d) => ({ ...d, done: e.target.checked }))}
        />
        <span>Mark as done</span>
      </label>

      {saveError ? (
        <p className="text-xs text-destructive">{saveError}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={w.actionStatus === "running"}>
          {w.actionStatus === "running" ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setDraft(readDraft(w.mappedRecord))}
          disabled={w.actionStatus === "running"}
        >
          Reset
        </Button>
        {w.actionStatus === "error" && w.actionError ? (
          <span className="text-xs text-destructive">{w.actionError}</span>
        ) : null}
      </div>

      <GristSelectionDebug w={w} />
    </form>
  )
}

function TemplateBody({ w }: { w: TemplateGrist }) {
  if (w.mode === "empty") {
    return (
      <div className="flex flex-col gap-4 p-6 text-sm">
        <p>Select a row in Grist to start.</p>
        <GristSelectionDebug w={w} />
      </div>
    )
  }

  if (w.mode === "new-row") {
    return (
      <div className="flex flex-col gap-4 p-6 text-sm">
        <p>Create the new row in Grist, then continue here.</p>
        <GristSelectionDebug w={w} />
      </div>
    )
  }

  if (!w.columnMappingStatus.ok) {
    return (
      <div className="flex flex-col gap-4 p-6 text-sm">
        <p>
          Open the widget configuration panel and map the two required
          columns: Title, Done.
        </p>
        <GristSelectionDebug w={w} />
      </div>
    )
  }

  return <RowEditor key={String(w.record!.id)} w={w} />
}

/**
 * Remount the body when the selected row changes (same pattern as
 * `widgets/create-email-draft`). Keeps local `useState` in sync with Grist.
 */
export function App() {
  useWidgetMetadata(WIDGET_METADATA)

  const w = useGrist<TaskRow, TaskMapped>()
  const rowKey =
    w.record && typeof w.record.id === "number"
      ? String(w.record.id)
      : w.mode

  return <TemplateBody key={rowKey} w={w} />
}

export default App
