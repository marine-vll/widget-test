import { useEffect, useState } from "react"
import {
  decodeGristValue,
  encodeGristValue,
  normalizeGristChoiceListEntries,
  useGristSchema,
  type GristChoiceListEntry,
  type GristReplicaColumn,
  type GristRowRecord,
  type GristWidgetColumnMap,
  type UseGristResult,
} from "grist-widget-sdk"

import type { TaskMapped, TaskRow } from "@/grist-types"

/** Per-logical-field column metadata, used to decode/encode the fields that need it. */
export type TaskColumnSchemas = Partial<
  Record<keyof TaskMapped, GristReplicaColumn | undefined>
>

/** Look up each mapped logical field's real-column schema from a schema table. */
export function buildColumnSchemas(
  mappings: GristWidgetColumnMap | null,
  columns: Record<string, GristReplicaColumn> | undefined
): TaskColumnSchemas {
  const out: TaskColumnSchemas = {}
  if (!mappings || !columns) return out
  for (const [logical, real] of Object.entries(mappings)) {
    if (typeof real === "string")
      out[logical as keyof TaskMapped] = columns[real]
  }
  return out
}

/** Unwrap `decodeGristValue`'s `{ __ref, rowId }` shape into a plain row id. */
function unwrapRef(value: unknown): number | null {
  if (value && typeof value === "object" && "__ref" in value) {
    const rowId = (value as { rowId?: unknown }).rowId
    return typeof rowId === "number" ? rowId : null
  }
  return typeof value === "number" ? value : null
}

/**
 * Rename a raw section row to logical field names and decode the cells that
 * need column-aware decoding (Date, Ref, ChoiceList) — everything else
 * (Text, Choice) passes through unchanged.
 */
export function mapTaskRow(
  row: GristRowRecord<TaskRow>,
  mappings: GristWidgetColumnMap | null,
  schemas: TaskColumnSchemas
): GristRowRecord<TaskMapped> {
  const mapped: Partial<TaskMapped> = {}
  if (mappings) {
    for (const [logical, real] of Object.entries(mappings)) {
      if (typeof real !== "string") continue
      const raw = row[real]
      const schema = schemas[logical as keyof TaskMapped]
      const decoded = schema ? decodeGristValue(raw, schema) : raw
      switch (logical as keyof TaskMapped) {
        case "campagne":
          mapped.campagne = unwrapRef(decoded)
          break
        case "dateDebut":
          mapped.dateDebut = decoded instanceof Date ? decoded : null
          break
        case "dateFin":
          mapped.dateFin = decoded instanceof Date ? decoded : null
          break
        case "type":
          mapped.type = Array.isArray(decoded)
            ? decoded.map((v) => String(v))
            : []
          break
        default:
          ;(mapped as Record<string, unknown>)[logical] = decoded ?? ""
      }
    }
  }
  return {
    id: row.id,
    statut: mapped.statut ?? null,
    titre: mapped.titre ?? "",
    campagne: mapped.campagne ?? null,
    dateDebut: mapped.dateDebut ?? null,
    dateFin: mapped.dateFin ?? null,
    service: mapped.service ?? "",
    type: mapped.type ?? [],
    commentaires: mapped.commentaires ?? "",
    creePar: mapped.creePar ?? "",
  }
}

/**
 * Encode a logical-field patch back to Grist's wire form (Date -> epoch
 * seconds, Ref -> row id, ChoiceList -> `["L", ...]`) ready for `w.mapBack`.
 */
export function encodeTaskPatch(
  patch: Partial<TaskMapped>,
  schemas: TaskColumnSchemas
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  if ("dateDebut" in patch)
    out.dateDebut = encodeGristValue(patch.dateDebut, schemas.dateDebut)
  if ("dateFin" in patch)
    out.dateFin = encodeGristValue(patch.dateFin, schemas.dateFin)
  if ("campagne" in patch)
    out.campagne = encodeGristValue(patch.campagne, schemas.campagne)
  if ("type" in patch) out.type = encodeGristValue(patch.type, schemas.type)
  return out
}

/** Ordered Choice values for the Statut column (defines the Kanban columns), with styling. */
export function getStatutChoices(
  schema?: GristReplicaColumn
): GristChoiceListEntry[] {
  return normalizeGristChoiceListEntries(schema?.widgetOptions)
}

/** Target table id of a `Ref:TableName` column, or `null` if not a Ref column. */
export function refTargetTableId(column?: GristReplicaColumn): string | null {
  if (!column?.type?.startsWith("Ref:")) return null
  const tableId = column.type.slice("Ref:".length)
  return tableId || null
}

const LABEL_HINTS = [
  "nom",
  "name",
  "titre",
  "title",
  "libelle",
  "libellé",
  "label",
]

/** Best-effort pick of a human-readable column to display for a referenced row. */
function pickLabelColumnId(
  columns: Record<string, GristReplicaColumn>
): string | null {
  const candidates = Object.entries(columns).filter(
    ([, col]) => !col.isFormula || col.formulaKind === "none"
  )
  for (const hint of LABEL_HINTS) {
    const hit = candidates.find(
      ([colId, col]) =>
        colId.toLowerCase().includes(hint) ||
        (col.label ?? "").toLowerCase().includes(hint)
    )
    if (hit) return hit[0]
  }
  const firstText = candidates.find(([, col]) => col.type === "Text")
  if (firstText) return firstText[0]
  return candidates[0]?.[0] ?? null
}

export type RefRecordOption = { id: number; label: string }

/**
 * Records available for a Ref field's dropdown: resolves the referenced
 * table from column metadata, then fetches its rows with a best-guess label.
 */
export function useRefRecordOptions(
  w: Pick<UseGristResult, "fetchTableRows">,
  targetTableId: string | null
): { options: RefRecordOption[]; loading: boolean } {
  const refSchema = useGristSchema({
    tableId: targetTableId ?? undefined,
    replicaRowMode: "schema-only",
  })
  // Keyed by tableId so a stale fetch for a previous Ref target never leaks
  // into the render once `targetTableId` has already moved on.
  const [fetched, setFetched] = useState<{
    tableId: string
    options: RefRecordOption[]
  } | null>(null)

  const columns = refSchema.table?.columns
  // `w` (the whole `UseGristResult`) is *not* referentially stable — it's a
  // new object on every reactive change (see its JSDoc). Individual methods
  // like `fetchTableRows` are useCallback-wrapped and stable; depend on that
  // instead, or this effect re-fires (and re-fetches) on every render.
  const { fetchTableRows } = w

  useEffect(() => {
    if (!targetTableId || !columns) return
    let cancelled = false
    const labelColId = pickLabelColumnId(columns)
    fetchTableRows(targetTableId, { columns })
      .then((rows) => {
        if (cancelled) return
        setFetched({
          tableId: targetTableId,
          options: rows.map((row) => ({
            id: row.id,
            label: labelColId
              ? String(row[labelColId] ?? `#${row.id}`)
              : `#${row.id}`,
          })),
        })
      })
      .catch(() => {
        if (!cancelled) setFetched({ tableId: targetTableId, options: [] })
      })
    return () => {
      cancelled = true
    }
  }, [fetchTableRows, targetTableId, columns])

  const isCurrent = fetched?.tableId === targetTableId
  const options = isCurrent ? fetched.options : []
  const loading = targetTableId != null && columns != null && !isCurrent
  return { options, loading }
}

/** Label for the fallback bucket holding rows whose Statut isn't one of the known choices. */
export const UNASSIGNED_STATUS = "__unassigned__"

export type DropTarget = { taskId: number; statut: string }

/**
 * Pure resolution of a dnd-kit `DragEndEvent` into a task id + target Statut
 * value, or `null` when the event carries nothing actionable (dropped
 * outside any droppable). Kept dnd-kit-shape-agnostic (structural subset of
 * `DragEndEvent`) so it can be unit-tested without simulating real pointer
 * geometry in jsdom.
 */
export function resolveDropTarget(event: {
  active: { id: string | number }
  over: { id: string | number; data: { current?: { statut?: unknown } } } | null
}): DropTarget | null {
  if (!event.over) return null
  const taskId = Number(event.active.id)
  const statut = String(event.over.data.current?.statut ?? event.over.id)
  return { taskId, statut }
}
