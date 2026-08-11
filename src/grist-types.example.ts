/**
 * Example row types for `useGrist<TRow, TMapped>()`.
 * Rename to `grist-types.ts` and align field names with your `GRIST_OPTIONS.columns`.
 */

/** Raw section row (real column ids from Grist). */
export type TaskRow = {
  id: number
  Title?: string
  Done?: boolean
}

/** Logical names after column mapping (matches `columns[].name`). */
export type TaskMapped = {
  title: string
  done: boolean
}
