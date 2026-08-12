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
  /**
   * "Campagne" — like the widget it replaces, the mapped column isn't
   * required to be an actual Reference: it accepts Text, Choice, ChoiceList,
   * Ref, or RefList (whatever the document actually has), normalized to a
   * list of string values uniformly. `[String(rowId)]` for a Ref/RefList
   * (label resolved separately).
   */
  campagne: string[]
  dateDebut: Date | null
  /** Raw text fallback when the mapped column isn't decodable as a date. */
  dateDebutDisplay: string | null
  dateFin: Date | null
  dateFinDisplay: string | null
  service: string
  /** ChoiceList column. */
  type: string[]
  commentaires: string
  creePar: string
  /**
   * Read-only, filter-only fields (not part of the edit form -- "Géré par
   * l'équipe" is entirely Grist-managed now, via its own default value /
   * trigger formula, so the widget only ever reads it to power the filter
   * bar, never writes to it). Same uniform string-list decoding as
   * `campagne`.
   */
  filtreEquipe: string[]
  filtreCampagne: string[]
}
