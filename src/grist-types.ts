/**
 * Row types for `useGrist<TRow, TMapped>()`. Field names in `TaskMapped`
 * match `GRIST_OPTIONS.columns[].name` in `App.tsx`.
 */

/**
 * Raw section row. Real column ids depend on how each user maps the widget
 * in their own document, so this stays a loose bag of cells rather than
 * hardcoding column ids.
 */
export type TaskRow = Record<string, unknown>

/** Logical names after column mapping, already decoded to idiomatic JS values. */
export type TaskMapped = {
  /** Choice column driving the Kanban columns. */
  statut: string | null
  titre: string
  /** Referenced row id in the linked table, or `null` when unset. */
  campagne: number | null
  dateDebut: Date | null
  dateFin: Date | null
  service: string
  /** ChoiceList column. */
  type: string[]
  commentaires: string
  creePar: string
}
