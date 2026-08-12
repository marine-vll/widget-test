import { useMemo, useState, type FormEvent } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, Plus, Trash2 } from "lucide-react"
import {
  useGrist,
  useGristSchema,
  useWidgetMetadata,
  type GristChoiceListEntry,
  type UseGristOptions,
  type UseGristResult,
} from "grist-widget-sdk"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  buildColumnSchemas,
  distinctValues,
  encodeTaskPatch,
  findUnmappedColumns,
  getStatutChoices,
  isDateLikeColumn,
  isFormulaColumn,
  mapTaskRow,
  refTargetTableId,
  resolveDropTarget,
  resolveFieldKind,
  resolveRefOptionId,
  UNASSIGNED_STATUS,
  useRefRecordOptions,
  withSelectedFallback,
  type ColumnMappingGap,
  type FieldKind,
  type RefRecordOption,
  type TaskColumnSchemas,
} from "@/lib/grist-kanban"
import { cn } from "@/lib/utils"

import type { TaskMapped, TaskRow } from "./grist-types"

export const GRIST_OPTIONS: UseGristOptions = {
  requiredAccess: "full",
  columns: [
    { name: "statut", title: "Statut", type: "Choice" },
    { name: "titre", title: "Titre", type: "Text" },
    // No type restriction (matches the previous kanban2 widget's own
    // "Reference" field): whatever the mapped column turns out to be --
    // Text, Choice, ChoiceList, Ref, RefList, even a computed "Any"
    // formula column -- the form adapts (see `resolveFieldKind` /
    // `AdaptiveMultiField`) instead of requiring a real Reference.
    { name: "campagne", title: "Campagne", optional: true },
    {
      name: "dateDebut",
      title: "Date de début",
      type: "Date,DateTime",
      optional: true,
    },
    {
      name: "dateFin",
      title: "Date de fin",
      type: "Date,DateTime",
      optional: true,
    },
    {
      name: "service",
      title: "Service responsable",
      type: "Text",
      optional: true,
    },
    // Accepts either shape: some documents model "Type" as a single Choice,
    // others as a multi-value Choice List — the form adapts (see
    // `resolveFieldKind` / `AdaptiveMultiField`), so both map cleanly here.
    { name: "type", title: "Type", type: "Choice,ChoiceList", optional: true },
    {
      name: "commentaires",
      title: "Commentaires",
      type: "Text",
      optional: true,
    },
    { name: "creePar", title: "Créé par", type: "Text", optional: true },
    // Type unknown ahead of time (Text, Choice, ChoiceList, Ref, or RefList
    // depending on the document) — same adaptive treatment as `type`.
    {
      name: "gerePar",
      title: "Géré par l'équipe",
      type: "Text,Choice,ChoiceList,Ref,RefList",
      optional: true,
    },
  ],
}

export const WIDGET_METADATA = {
  title: "Kanban",
  description:
    "Tableau Kanban par statut, avec glisser-déposer entre colonnes.",
} as const

type Grist = UseGristResult<TaskRow, TaskMapped>
type Task = TaskMapped & { id: number }

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

/**
 * When Campagne is a real Ref/RefList, resolve its id to a fetched label;
 * otherwise `task.campagne[0]` is already the display text (Text/Choice/Any
 * column), so the lookup simply misses and that raw value is used as-is.
 */
function resolveCampagneLabel(
  task: Task,
  campagneLabelById: Map<string, string>
): string | null {
  const value = task.campagne[0]
  if (value == null) return null
  return campagneLabelById.get(value) ?? value
}

type ColumnData = { value: string; label: string; tasks: Task[] }

function buildColumns(
  choices: GristChoiceListEntry[],
  tasks: Task[]
): ColumnData[] {
  const known = new Set(choices.map((c) => c.value))
  const columns: ColumnData[] = choices.map((c) => ({
    value: c.value,
    label: c.label,
    tasks: [],
  }))
  const unassigned: ColumnData = {
    value: UNASSIGNED_STATUS,
    label: "Sans statut",
    tasks: [],
  }
  for (const task of tasks) {
    const bucket =
      task.statut && known.has(task.statut)
        ? columns.find((c) => c.value === task.statut)!
        : unassigned
    bucket.tasks.push(task)
  }
  return unassigned.tasks.length > 0 ? [...columns, unassigned] : columns
}

function toDateInputValue(date: Date | null): string {
  if (!date) return ""
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function fromDateInputValue(value: string): Date | null {
  if (!value) return null
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

type Draft = {
  campagne: string[]
  titre: string
  dateDebut: string
  dateFin: string
  service: string
  type: string[]
  commentaires: string
  statut: string
  creePar: string
  gerePar: string[]
}

function draftFromTask(task: Task | null, defaultStatut: string): Draft {
  return {
    campagne: task?.campagne ?? [],
    titre: task?.titre ?? "",
    dateDebut: toDateInputValue(task?.dateDebut ?? null),
    dateFin: toDateInputValue(task?.dateFin ?? null),
    service: task?.service ?? "",
    type: task?.type ?? [],
    commentaires: task?.commentaires ?? "",
    statut: task?.statut ?? defaultStatut,
    creePar: task?.creePar ?? "",
    gerePar: task?.gerePar ?? [],
  }
}

/** Presentational-only card body, reused by the sortable card and its DragOverlay clone. */
function TaskCardContent({
  task,
  campagneLabel,
}: {
  task: Task
  campagneLabel: string | null
}) {
  return (
    <>
      {campagneLabel ? (
        <div className="mb-1 flex justify-end">
          <span className="max-w-full truncate rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            #{campagneLabel}
          </span>
        </div>
      ) : null}
      <p className="font-medium text-foreground">
        {task.titre || "(Sans titre)"}
      </p>
      {task.service || task.dateFin || task.dateFinDisplay ? (
        <dl className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {task.service ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Service :</dt>
              <dd className="truncate">{task.service}</dd>
            </div>
          ) : null}
          {task.dateFin || task.dateFinDisplay ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Échéance :</dt>
              <dd className="truncate">
                {task.dateFin ? formatDate(task.dateFin) : task.dateFinDisplay}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {task.type.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.type.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      ) : null}
    </>
  )
}

function TaskCard({
  task,
  campagneLabel,
  onOpen,
}: {
  task: Task
  campagneLabel: string | null
  onOpen: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { statut: task.statut },
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen()
      }}
      className={cn(
        "cursor-grab rounded-md border border-border bg-card p-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDragging && "opacity-40"
      )}
    >
      <TaskCardContent task={task} campagneLabel={campagneLabel} />
    </div>
  )
}

/** Floating clone that follows the pointer during a drag (see `DragOverlay` in `KanbanBoard`).
 *  Without this, the dragged card stays visually clipped by its own column's
 *  scroll container while crossing into another column — the "saccadé" feel. */
function TaskCardOverlay({
  task,
  campagneLabel,
}: {
  task: Task
  campagneLabel: string | null
}) {
  return (
    <div className="cursor-grabbing rounded-md border border-primary bg-card p-2.5 text-left text-sm shadow-lg">
      <TaskCardContent task={task} campagneLabel={campagneLabel} />
    </div>
  )
}

function KanbanColumn({
  column,
  campagneLabelById,
  onOpenTask,
}: {
  column: ColumnData
  campagneLabelById: Map<string, string>
  onOpenTask: (task: Task) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.value,
    data: { statut: column.value },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-96 shrink-0 flex-col rounded-md border border-border bg-background",
        isOver && "border-primary ring-1 ring-primary"
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium text-foreground">{column.label}</h2>
        <Badge>{column.tasks.length}</Badge>
      </div>
      <SortableContext
        items={column.tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {column.tasks.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Aucune tâche
            </p>
          ) : (
            column.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                campagneLabel={resolveCampagneLabel(task, campagneLabelById)}
                onOpen={() => onOpenTask(task)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/**
 * A field whose Grist column type isn't fixed across documents (Type, "Géré
 * par l'équipe"): renders a text input, a single select, a checkbox group,
 * or a Ref select, depending on what the mapped column actually turned out
 * to be (`resolveFieldKind`).
 */
function AdaptiveMultiField({
  id,
  kind,
  values,
  onChange,
  choices,
  refOptions,
  refLoading,
  suggestions = [],
  disabled = false,
}: {
  id: string
  kind: FieldKind
  values: string[]
  onChange: (values: string[]) => void
  choices: GristChoiceListEntry[]
  refOptions: RefRecordOption[]
  refLoading: boolean
  /** Free-text kind only: past values of this same field, offered as a datalist autocomplete
   *  (mirrors the previous widget's own "reference" field, which had no linked table to browse). */
  suggestions?: string[]
  /** The mapped column is a Grist formula -- Grist rejects writes to it regardless of this UI. */
  disabled?: boolean
}) {
  if (kind === "choicelist") {
    return (
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1"
      >
        {choices.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun choix configuré</p>
        ) : (
          choices.map((choice) => (
            <label
              key={choice.value}
              className="flex items-center gap-1.5 text-sm"
            >
              <Checkbox
                disabled={disabled}
                checked={values.includes(choice.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...values, choice.value]
                      : values.filter((v) => v !== choice.value)
                  )
                }
              />
              {choice.label}
            </label>
          ))
        )}
      </div>
    )
  }

  if (kind === "choice") {
    return (
      <Select
        id={id}
        disabled={disabled}
        value={values[0] ?? ""}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      >
        <option value="">—</option>
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    )
  }

  if (kind === "ref") {
    // The value read back may be a row id *or* the linked record's display
    // text (what Grist actually delivers for a Reference cell) -- resolve
    // whichever it is against the fetched options to find the real id.
    const rawValue = values[0] ?? null
    const selectedId =
      rawValue != null ? resolveRefOptionId(rawValue, refOptions) : null
    // Text that didn't match any fetched option yet (still loading, or a
    // genuine mismatch) -- keep it visible via a synthetic entry instead of
    // reverting to "—", which would look exactly like "the value was lost".
    const unresolved = rawValue != null && selectedId == null
    const options = withSelectedFallback(refOptions, selectedId, refLoading)
    return (
      <Select
        id={id}
        disabled={disabled}
        value={
          unresolved
            ? "__unresolved__"
            : selectedId != null
              ? String(selectedId)
              : ""
        }
        onChange={(e) =>
          onChange(
            e.target.value && e.target.value !== "__unresolved__"
              ? [e.target.value]
              : []
          )
        }
      >
        <option value="">—</option>
        {unresolved ? (
          <option value="__unresolved__">
            {refLoading ? "Chargement…" : rawValue}
          </option>
        ) : null}
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </Select>
    )
  }

  if (kind === "reflist") {
    // Same display-text-vs-id ambiguity as "ref" -- resolve each value
    // against the fetched options before checking membership.
    const selectedIds = new Set(
      values
        .map((v) => resolveRefOptionId(v, refOptions))
        .filter((v): v is number => v != null)
    )
    function toggle(optId: number, checked: boolean) {
      const next = new Set(selectedIds)
      if (checked) next.add(optId)
      else next.delete(optId)
      onChange(Array.from(next, String))
    }
    return (
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1"
      >
        {refOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {refLoading ? "Chargement…" : "Aucun élément disponible"}
          </p>
        ) : (
          refOptions.map((opt) => (
            <label key={opt.id} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                disabled={disabled}
                checked={selectedIds.has(opt.id)}
                onCheckedChange={(checked) => toggle(opt.id, checked === true)}
              />
              {opt.label}
            </label>
          ))
        )}
      </div>
    )
  }

  // text / unknown -- a free-text value, optionally with a datalist of
  // previously-seen values in this same field to make selection easier
  // without needing a real linked table (kanban2's own approach).
  const listId = suggestions.length > 0 ? `${id}-suggestions` : undefined
  return (
    <>
      <Input
        id={id}
        list={listId}
        disabled={disabled}
        value={values[0] ?? ""}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      />
      {listId ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}

function TaskFormPanel({
  mode,
  task,
  defaultStatut,
  statutChoices,
  typeKind,
  typeChoices,
  typeDisabled,
  campagneKind,
  campagneChoices,
  campagneOptions,
  campagneLoading,
  campagneSuggestions,
  campagneDisabled,
  dateDebutIsDate,
  dateDebutDisabled,
  dateFinIsDate,
  dateFinDisabled,
  gereParKind,
  gereParChoices,
  gereParOptions,
  gereParLoading,
  gereParDisabled,
  onSave,
  onDelete,
}: {
  mode: "new" | "edit"
  task: Task | null
  defaultStatut: string
  statutChoices: GristChoiceListEntry[]
  typeKind: FieldKind
  typeChoices: GristChoiceListEntry[]
  typeDisabled: boolean
  campagneKind: FieldKind
  campagneChoices: GristChoiceListEntry[]
  campagneOptions: RefRecordOption[]
  campagneLoading: boolean
  campagneSuggestions: string[]
  campagneDisabled: boolean
  dateDebutIsDate: boolean
  dateDebutDisabled: boolean
  dateFinIsDate: boolean
  dateFinDisabled: boolean
  gereParKind: FieldKind
  gereParChoices: GristChoiceListEntry[]
  gereParOptions: RefRecordOption[]
  gereParLoading: boolean
  gereParDisabled: boolean
  onSave: (patch: Partial<TaskMapped>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    draftFromTask(task, defaultStatut)
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || deleting
  const dateDebutEditable = dateDebutIsDate && !dateDebutDisabled
  const dateFinEditable = dateFinIsDate && !dateFinDisabled

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave({
        // Grist rejects a write to a formula-backed column regardless of
        // what this UI shows -- omit these from the patch entirely rather
        // than let the whole save fail over an untouched disabled field.
        ...(campagneDisabled ? {} : { campagne: draft.campagne }),
        titre: draft.titre,
        ...(dateDebutEditable
          ? { dateDebut: fromDateInputValue(draft.dateDebut) }
          : {}),
        ...(dateFinEditable
          ? { dateFin: fromDateInputValue(draft.dateFin) }
          : {}),
        service: draft.service,
        ...(typeDisabled ? {} : { type: draft.type }),
        commentaires: draft.commentaires,
        statut: draft.statut,
        creePar: draft.creePar,
        ...(gereParDisabled ? {} : { gerePar: draft.gerePar }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    setError(null)
    setDeleting(true)
    try {
      await onDelete()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setDeleting(false)
    }
  }

  return (
    <SheetContent
      title={mode === "new" ? "Nouvelle tâche" : "Modifier la tâche"}
      description="Formulaire de tâche"
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-4 overflow-y-auto px-5 py-4">
          {/* Ligne 1 : Campagne -- pas forcément une vraie Référence Grist
              (voir kanban2, dont ce champ s'inspire) : le contrôle s'adapte
              au type réel de la colonne mappée, désactivé seulement si
              c'est une colonne calculée que Grist refuserait d'écrire. */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="task-campagne" id="task-campagne-label">
              Campagne
            </Label>
            <AdaptiveMultiField
              id="task-campagne"
              kind={campagneKind}
              values={draft.campagne}
              onChange={(values) =>
                setDraft((d) => ({ ...d, campagne: values }))
              }
              choices={campagneChoices}
              refOptions={campagneOptions}
              refLoading={campagneLoading}
              suggestions={campagneSuggestions}
              disabled={campagneDisabled}
            />
          </div>

          {/* Ligne 2 : Titre */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="task-titre">Titre</Label>
            <Input
              id="task-titre"
              required
              value={draft.titre}
              onChange={(e) =>
                setDraft((d) => ({ ...d, titre: e.target.value }))
              }
            />
          </div>

          {/* Ligne 3 : Date début + Date fin */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-date-debut">Date début</Label>
            {dateDebutIsDate ? (
              <Input
                id="task-date-debut"
                type="date"
                disabled={dateDebutDisabled}
                value={draft.dateDebut}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dateDebut: e.target.value }))
                }
              />
            ) : (
              <Input
                id="task-date-debut"
                disabled
                readOnly
                value={task?.dateDebutDisplay ?? ""}
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-date-fin">Date fin</Label>
            {dateFinIsDate ? (
              <Input
                id="task-date-fin"
                type="date"
                disabled={dateFinDisabled}
                value={draft.dateFin}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, dateFin: e.target.value }))
                }
              />
            ) : (
              <Input
                id="task-date-fin"
                disabled
                readOnly
                value={task?.dateFinDisplay ?? ""}
              />
            )}
          </div>

          {/* Ligne 4 : Service responsable + Géré par l'équipe */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-service">Service responsable</Label>
            <Input
              id="task-service"
              value={draft.service}
              onChange={(e) =>
                setDraft((d) => ({ ...d, service: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-gere-par" id="task-gere-par-label">
              Géré par l'équipe
            </Label>
            <AdaptiveMultiField
              id="task-gere-par"
              kind={gereParKind}
              values={draft.gerePar}
              onChange={(values) =>
                setDraft((d) => ({ ...d, gerePar: values }))
              }
              choices={gereParChoices}
              refOptions={gereParOptions}
              refLoading={gereParLoading}
              disabled={gereParDisabled}
            />
          </div>

          {/* Ligne 4bis : Type (pleine largeur — ne tenait pas à trois sur la ligne du dessus) */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="task-type" id="task-type-label">
              Type
            </Label>
            <AdaptiveMultiField
              id="task-type"
              kind={typeKind}
              values={draft.type}
              onChange={(values) => setDraft((d) => ({ ...d, type: values }))}
              choices={typeChoices}
              refOptions={[]}
              refLoading={false}
              disabled={typeDisabled}
            />
          </div>

          {/* Ligne 5 : Commentaires */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="task-commentaires">Commentaires</Label>
            <Textarea
              id="task-commentaires"
              className="min-h-28"
              value={draft.commentaires}
              onChange={(e) =>
                setDraft((d) => ({ ...d, commentaires: e.target.value }))
              }
            />
          </div>

          {/* Ligne 6 : Statut + Créé par */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-statut">Statut</Label>
            <Select
              id="task-statut"
              value={draft.statut}
              onChange={(e) =>
                setDraft((d) => ({ ...d, statut: e.target.value }))
              }
            >
              {statutChoices.length === 0 ? <option value="">—</option> : null}
              {statutChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-cree-par">Créé par</Label>
            <Input
              id="task-cree-par"
              value={draft.creePar}
              onChange={(e) =>
                setDraft((d) => ({ ...d, creePar: e.target.value }))
              }
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="px-5 pb-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        {/* Ligne 7 : Valider + Supprimer */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          <Button type="submit" disabled={busy} className="flex-1">
            <Check className="size-4" />
            {saving ? "Enregistrement…" : "Valider"}
          </Button>
          {onDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={handleDelete}
              className="flex-1"
            >
              <Trash2 className="size-4" />
              {deleting ? "Suppression…" : "Supprimer"}
            </Button>
          ) : null}
        </div>
      </form>
    </SheetContent>
  )
}

type PanelState = {
  mode: "new" | "edit"
  task: Task | null
  defaultStatut: string
}

function KanbanBoard({
  w,
  schemas,
  unmappedColumns,
}: {
  w: Grist
  schemas: TaskColumnSchemas
  unmappedColumns: ColumnMappingGap[]
}) {
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  const tasks = useMemo(
    () =>
      (w.records ?? []).map((row) =>
        mapTaskRow(row, w.recordsMappings, schemas)
      ),
    [w.records, w.recordsMappings, schemas]
  )

  const gereParFilterOptions = useMemo(
    () => distinctValues(tasks.map((t) => t.gerePar)),
    [tasks]
  )
  const filteredTasks = useMemo(
    () =>
      activeFilter
        ? tasks.filter((t) => t.gerePar.includes(activeFilter))
        : tasks,
    [tasks, activeFilter]
  )

  const statutChoices = useMemo(
    () => getStatutChoices(schemas.statut),
    [schemas.statut]
  )
  const typeKind = useMemo(() => resolveFieldKind(schemas.type), [schemas.type])
  const typeChoices = useMemo(
    () => getStatutChoices(schemas.type),
    [schemas.type]
  )
  const typeDisabled = useMemo(
    () => isFormulaColumn(schemas.type),
    [schemas.type]
  )
  const gereParKind = useMemo(
    () => resolveFieldKind(schemas.gerePar),
    [schemas.gerePar]
  )
  const gereParChoices = useMemo(
    () => getStatutChoices(schemas.gerePar),
    [schemas.gerePar]
  )
  const gereParDisabled = useMemo(
    () => isFormulaColumn(schemas.gerePar),
    [schemas.gerePar]
  )
  const columns = useMemo(
    () => buildColumns(statutChoices, filteredTasks),
    [statutChoices, filteredTasks]
  )

  const campagneKind = useMemo(
    () => resolveFieldKind(schemas.campagne),
    [schemas.campagne]
  )
  const campagneChoices = useMemo(
    () => getStatutChoices(schemas.campagne),
    [schemas.campagne]
  )
  const campagneDisabled = useMemo(
    () => isFormulaColumn(schemas.campagne),
    [schemas.campagne]
  )
  const campagneTableId = useMemo(
    () => refTargetTableId(schemas.campagne),
    [schemas.campagne]
  )
  const { options: campagneOptions, loading: campagneLoading } =
    useRefRecordOptions(w, campagneTableId)
  const campagneLabelById = useMemo(
    () => new Map(campagneOptions.map((o) => [String(o.id), o.label])),
    [campagneOptions]
  )
  // Free-text fallback (no real linked table): distinct values already used
  // for Campagne across loaded tasks, offered as autocomplete suggestions --
  // same idea as kanban2's own "reference" field, which had no true lookup
  // table either.
  const campagneSuggestions = useMemo(
    () => distinctValues(tasks.map((t) => t.campagne)),
    [tasks]
  )

  const dateDebutIsDate = useMemo(
    () => isDateLikeColumn(schemas.dateDebut),
    [schemas.dateDebut]
  )
  const dateDebutDisabled = useMemo(
    () => isFormulaColumn(schemas.dateDebut),
    [schemas.dateDebut]
  )
  const dateFinIsDate = useMemo(
    () => isDateLikeColumn(schemas.dateFin),
    [schemas.dateFin]
  )
  const dateFinDisabled = useMemo(
    () => isFormulaColumn(schemas.dateFin),
    [schemas.dateFin]
  )

  const gereParTableId = useMemo(
    () => refTargetTableId(schemas.gerePar),
    [schemas.gerePar]
  )
  const { options: gereParOptions, loading: gereParLoading } =
    useRefRecordOptions(w, gereParTableId)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function moveTask(taskId: number, newStatut: string) {
    await w.table.update({
      id: taskId,
      fields: w.mapBack({ statut: newStatut }),
    })
  }

  function handleDragStart(event: DragStartEvent) {
    const id = Number(event.active.id)
    setActiveTask(tasks.find((t) => t.id === id) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null)
    const target = resolveDropTarget(event)
    if (!target) return
    const task = tasks.find((t) => t.id === target.taskId)
    if (!task) return
    const currentStatut = task.statut ?? UNASSIGNED_STATUS
    if (currentStatut === target.statut) return
    void moveTask(
      target.taskId,
      target.statut === UNASSIGNED_STATUS ? "" : target.statut
    )
  }

  async function saveTask(
    patch: Partial<TaskMapped>,
    existingId: number | null
  ) {
    const fields = w.mapBack(encodeTaskPatch(patch, schemas))
    if (existingId != null) {
      await w.table.update({ id: existingId, fields })
    } else {
      await w.table.create({ fields })
    }
  }

  async function deleteTask(id: number) {
    await w.table.destroy(id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <h1 className="text-sm font-medium text-foreground">Tâches</h1>
        <Button
          size="sm"
          className="justify-center text-sm"
          onClick={() =>
            setPanel({
              mode: "new",
              task: null,
              defaultStatut: statutChoices[0]?.value ?? "",
            })
          }
        >
          <Plus className="size-4" />
          Ajouter une action
        </Button>
      </header>

      {unmappedColumns.length > 0 ? (
        <p
          role="status"
          className="border-b border-border bg-accent/40 px-4 py-2 text-xs text-accent-foreground"
        >
          Colonnes pas encore associées dans la configuration du widget (icône ⚙
          du panneau Grist) : {unmappedColumns.map((c) => c.title).join(", ")}.
          Tant qu'une colonne n'est pas associée à une colonne réelle, son champ
          reste vide ici — même si la donnée existe déjà dans la table.
        </p>
      ) : null}

      {gereParFilterOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background px-4 py-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Géré par
          </span>
          <button
            type="button"
            onClick={() => setActiveFilter(null)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-xs",
              activeFilter === null
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            Tous
          </button>
          {gereParFilterOptions.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setActiveFilter((cur) => (cur === value ? null : value))
              }
              className={cn(
                "rounded-sm border px-2 py-0.5 text-xs",
                activeFilter === value
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}

      {w.actionError ? (
        <p
          role="alert"
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {w.actionError}
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {columns.map((column) => (
            <KanbanColumn
              key={column.value}
              column={column}
              campagneLabelById={campagneLabelById}
              onOpenTask={(task) =>
                setPanel({
                  mode: "edit",
                  task,
                  defaultStatut: task.statut ?? "",
                })
              }
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCardOverlay
              task={activeTask}
              campagneLabel={resolveCampagneLabel(
                activeTask,
                campagneLabelById
              )}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <Sheet
        open={panel != null}
        onOpenChange={(open) => !open && setPanel(null)}
      >
        {panel ? (
          <TaskFormPanel
            key={panel.task?.id ?? "new"}
            mode={panel.mode}
            task={panel.task}
            defaultStatut={panel.defaultStatut}
            statutChoices={statutChoices}
            typeKind={typeKind}
            typeChoices={typeChoices}
            typeDisabled={typeDisabled}
            campagneKind={campagneKind}
            campagneChoices={campagneChoices}
            campagneOptions={campagneOptions}
            campagneLoading={campagneLoading}
            campagneSuggestions={campagneSuggestions}
            campagneDisabled={campagneDisabled}
            dateDebutIsDate={dateDebutIsDate}
            dateDebutDisabled={dateDebutDisabled}
            dateFinIsDate={dateFinIsDate}
            dateFinDisabled={dateFinDisabled}
            gereParKind={gereParKind}
            gereParChoices={gereParChoices}
            gereParOptions={gereParOptions}
            gereParLoading={gereParLoading}
            gereParDisabled={gereParDisabled}
            onSave={async (patch) => {
              await saveTask(patch, panel.task?.id ?? null)
              setPanel(null)
            }}
            onDelete={
              panel.task
                ? async () => {
                    await deleteTask(panel.task!.id)
                    setPanel(null)
                  }
                : undefined
            }
          />
        ) : null}
      </Sheet>
    </div>
  )
}

export function App() {
  useWidgetMetadata(WIDGET_METADATA)
  const w = useGrist<TaskRow, TaskMapped>()
  const schema = useGristSchema({
    tableId: w.currentTableId ?? undefined,
    replicaRowMode: "schema-only",
  })

  const schemas = useMemo(
    () => buildColumnSchemas(w.recordsMappings, schema.table?.columns),
    [w.recordsMappings, schema.table?.columns]
  )

  const unmappedColumns = useMemo(
    () => findUnmappedColumns(w.recordsMappings, GRIST_OPTIONS.columns),
    [w.recordsMappings]
  )

  if (w.columnMappingStatus.pending) {
    return (
      <EmptyState
        title="Connexion…"
        message="Connexion au document Grist en cours."
      />
    )
  }

  if (!w.columnMappingStatus.ok) {
    return (
      <EmptyState
        title="Configuration requise"
        message="Ouvre le panneau de configuration du widget dans Grist et associe au moins les colonnes Statut et Titre."
      />
    )
  }

  return (
    <KanbanBoard w={w} schemas={schemas} unmappedColumns={unmappedColumns} />
  )
}

export default App
