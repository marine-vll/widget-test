import { useEffect, useState } from "react"
import {
  decodeGristValue,
  encodeGristValue,
  normalizeGristChoiceListEntries,
  useGristSchema,
  type GristChoiceListEntry,
  type GristColumnsToMap,
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

/**
 * What shape a column's values actually take. A handful of fields (Type,
 * "Géré par l'équipe") aren't pinned to one Grist column type across
 * documents, so the form adapts its control to whichever of these the
 * mapped column turns out to be.
 */
export type FieldKind = "text" | "choice" | "choicelist" | "ref" | "unknown"

export function resolveFieldKind(schema?: GristReplicaColumn): FieldKind {
  if (!schema?.type) return "unknown"
  if (schema.type === "ChoiceList") return "choicelist"
  if (schema.type === "Choice") return "choice"
  if (schema.type.startsWith("Ref:")) return "ref"
  return "text"
}

/**
 * Unwrap `decodeGristValue`'s `{ __ref, rowId }` shape (or a bare row id)
 * into a plain row id. Grist represents an *unset* Ref cell as `0`, not
 * `null` — treat that as unset too, or an unlinked task would otherwise
 * resolve to "row #0" instead of "no campagne".
 */
function unwrapRef(value: unknown): number | null {
  if (value && typeof value === "object" && "__ref" in value) {
    const rowId = (value as { rowId?: unknown }).rowId
    return typeof rowId === "number" && rowId !== 0 ? rowId : null
  }
  return typeof value === "number" && value !== 0 ? value : null
}

/**
 * Decode a cell whose column might be Text, Choice, ChoiceList, or Ref into
 * a uniform string list (`[]` unset, `[value]` scalar, full list for
 * ChoiceList, `[String(rowId)]` for Ref — label resolved separately).
 * Tolerates a value shape that doesn't match the declared kind (e.g. a
 * scalar Choice read where `ChoiceList` was expected) instead of dropping it
 * silently, since the two are easy to mix up when mapping a widget column.
 */
function decodeMultiValue(
  raw: unknown,
  schema: GristReplicaColumn | undefined
): string[] {
  const kind = resolveFieldKind(schema)
  const decoded = schema ? decodeGristValue(raw, schema) : raw
  if (kind === "ref") {
    const rowId = unwrapRef(decoded)
    return rowId != null ? [String(rowId)] : []
  }
  if (Array.isArray(decoded)) return decoded.map((v) => String(v))
  if (decoded == null || decoded === "") return []
  return [String(decoded)]
}

/** Encode a uniform string list back to the wire form matching the column's actual kind. */
function encodeMultiValue(
  values: string[],
  schema: GristReplicaColumn | undefined
): unknown {
  const kind = resolveFieldKind(schema)
  if (kind === "choicelist") return encodeGristValue(values, schema)
  if (kind === "ref")
    return encodeGristValue(values[0] ? Number(values[0]) : null, schema)
  return values[0] ?? ""
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
      switch (logical as keyof TaskMapped) {
        case "campagne":
          mapped.campagne = unwrapRef(
            schema ? decodeGristValue(raw, schema) : raw
          )
          break
        case "dateDebut": {
          const decoded = schema ? decodeGristValue(raw, schema) : raw
          mapped.dateDebut = decoded instanceof Date ? decoded : null
          break
        }
        case "dateFin": {
          const decoded = schema ? decodeGristValue(raw, schema) : raw
          mapped.dateFin = decoded instanceof Date ? decoded : null
          break
        }
        case "type":
          mapped.type = decodeMultiValue(raw, schema)
          break
        case "gerePar":
          mapped.gerePar = decodeMultiValue(raw, schema)
          break
        default: {
          const decoded = schema ? decodeGristValue(raw, schema) : raw
          ;(mapped as Record<string, unknown>)[logical] = decoded ?? ""
        }
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
    gerePar: mapped.gerePar ?? [],
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
  if ("type" in patch)
    out.type = encodeMultiValue(patch.type ?? [], schemas.type)
  if ("gerePar" in patch)
    out.gerePar = encodeMultiValue(patch.gerePar ?? [], schemas.gerePar)
  return out
}

/** Ordered Choice values for a Choice/ChoiceList column (defines the Kanban columns, or a picklist). */
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
      .catch((err: unknown) => {
        // Surface the failure instead of leaving the dropdown silently and
        // permanently empty with no way to tell "still loading" from "broken".
        console.error(
          `Kanban: failed to load rows for referenced table "${targetTableId}"`,
          err
        )
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

/**
 * Guarantee the currently-selected id always has a matching `<option>`, even
 * before its real label has loaded (or if the fetch failed) — otherwise a
 * native `<select value=selected>` silently falls back to its first option
 * whenever `selected` isn't among the rendered ones, which looks exactly
 * like "the field didn't pre-fill" even though the value is held correctly.
 */
export function withSelectedFallback(
  options: RefRecordOption[],
  selectedId: number | null,
  loading: boolean
): RefRecordOption[] {
  if (selectedId == null || options.some((o) => o.id === selectedId))
    return options
  return [
    { id: selectedId, label: loading ? "Chargement…" : `#${selectedId}` },
    ...options,
  ]
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

export type ColumnMappingGap = { name: string; title: string }

/**
 * Logical fields declared in `GRIST_OPTIONS.columns` that currently have no
 * real column assigned in Grist's own widget configuration panel (the
 * per-field pickers next to the ⚙ icon) — as opposed to a read/decode bug in
 * this widget's code. A field left unmapped there always reads as empty
 * here, indistinguishable from "the code failed to read it" without this
 * check, since `w.recordsMappings` simply omits (or nulls) its entry.
 */
export function findUnmappedColumns(
  mappings: GristWidgetColumnMap | null,
  columnsSpec: GristColumnsToMap | undefined
): ColumnMappingGap[] {
  if (!columnsSpec) return []
  const gaps: ColumnMappingGap[] = []
  for (const col of columnsSpec) {
    if (typeof col === "string") continue
    const real = mappings?.[col.name]
    const isMapped = Array.isArray(real)
      ? real.length > 0
      : typeof real === "string" && real.length > 0
    if (!isMapped) gaps.push({ name: col.name, title: col.title ?? col.name })
  }
  return gaps
}

/** Distinct, non-empty values of a multi-value field across a set of tasks, for building filter pills. */
export function distinctFieldValues(
  tasks: readonly { gerePar: string[] }[]
): string[] {
  const seen = new Set<string>()
  for (const task of tasks) {
    for (const value of task.gerePar) {
      if (value) seen.add(value)
    }
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, "fr"))
}
