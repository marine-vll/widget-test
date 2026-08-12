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
  /**
   * "Géré par l'équipe" — column type isn't fixed (Text, Choice, ChoiceList,
   * or Ref, depending on how each document set it up), so it's normalized to
   * a list of string values uniformly: `[]` unset, `[value]` for a scalar,
   * the full list for a ChoiceList, `[String(rowId)]` for a Ref (label
   * resolved separately, same as `campagne`).
   */
  gerePar: string[]
}
