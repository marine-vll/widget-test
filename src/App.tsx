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
  distinctFieldValues,
  encodeTaskPatch,
  findUnmappedColumns,
  getStatutChoices,
  mapTaskRow,
  refTargetTableId,
  resolveDropTarget,
  resolveFieldKind,
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
    { name: "campagne", title: "Campagne", type: "Ref", optional: true },
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
    // Type unknown ahead of time (Text, Choice, ChoiceList, or Ref
    // depending on the document) — same adaptive treatment as `type`.
    {
      name: "gerePar",
      title: "Géré par l'équipe",
      type: "Text,Choice,ChoiceList,Ref",
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
  campagne: number | null
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
    campagne: task?.campagne ?? null,
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
      <p className="font-medium text-foreground">
        {task.titre || "(Sans titre)"}
      </p>
      {campagneLabel || task.service || task.dateFin ? (
        <dl className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
          {campagneLabel ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Campagne :</dt>
              <dd className="truncate">{campagneLabel}</dd>
            </div>
          ) : null}
          {task.service ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Service :</dt>
              <dd className="truncate">{task.service}</dd>
            </div>
          ) : null}
          {task.dateFin ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Échéance :</dt>
              <dd>{formatDate(task.dateFin)}</dd>
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
  campagneLabelById: Map<number, string>
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
                campagneLabel={
                  task.campagne != null
                    ? (campagneLabelById.get(task.campagne) ??
                      `#${task.campagne}`)
                    : null
                }
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
}: {
  id: string
  kind: FieldKind
  values: string[]
  onChange: (values: string[]) => void
  choices: GristChoiceListEntry[]
  refOptions: RefRecordOption[]
  refLoading: boolean
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
    const selectedId = values[0] ? Number(values[0]) : null
    const options = withSelectedFallback(refOptions, selectedId, refLoading)
    return (
      <Select
        id={id}
        value={selectedId != null ? String(selectedId) : ""}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </Select>
    )
  }

  return (
    <Input
      id={id}
      value={values[0] ?? ""}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
    />
  )
}

function TaskFormPanel({
  mode,
  task,
  defaultStatut,
  statutChoices,
  typeKind,
  typeChoices,
  campagneOptions,
  campagneLoading,
  gereParKind,
  gereParChoices,
  gereParOptions,
  gereParLoading,
  onSave,
  onDelete,
}: {
  mode: "new" | "edit"
  task: Task | null
  defaultStatut: string
  statutChoices: GristChoiceListEntry[]
  typeKind: FieldKind
  typeChoices: GristChoiceListEntry[]
  campagneOptions: RefRecordOption[]
  campagneLoading: boolean
  gereParKind: FieldKind
  gereParChoices: GristChoiceListEntry[]
  gereParOptions: RefRecordOption[]
  gereParLoading: boolean
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSave({
        campagne: draft.campagne,
        titre: draft.titre,
        dateDebut: fromDateInputValue(draft.dateDebut),
        dateFin: fromDateInputValue(draft.dateFin),
        service: draft.service,
        type: draft.type,
        commentaires: draft.commentaires,
        statut: draft.statut,
        creePar: draft.creePar,
        gerePar: draft.gerePar,
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
          {/* Ligne 1 : Campagne (référence) */}
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="task-campagne">Campagne</Label>
            <Select
              id="task-campagne"
              value={draft.campagne != null ? String(draft.campagne) : ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  campagne: e.target.value ? Number(e.target.value) : null,
                }))
              }
            >
              <option value="">—</option>
              {withSelectedFallback(
                campagneOptions,
                draft.campagne,
                campagneLoading
              ).map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>
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
            <Input
              id="task-date-debut"
              type="date"
              value={draft.dateDebut}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dateDebut: e.target.value }))
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-date-fin">Date fin</Label>
            <Input
              id="task-date-fin"
              type="date"
              value={draft.dateFin}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dateFin: e.target.value }))
              }
            />
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
    () => distinctFieldValues(tasks),
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
  const gereParKind = useMemo(
    () => resolveFieldKind(schemas.gerePar),
    [schemas.gerePar]
  )
  const gereParChoices = useMemo(
    () => getStatutChoices(schemas.gerePar),
    [schemas.gerePar]
  )
  const columns = useMemo(
    () => buildColumns(statutChoices, filteredTasks),
    [statutChoices, filteredTasks]
  )

  const campagneTableId = useMemo(
    () => refTargetTableId(schemas.campagne),
    [schemas.campagne]
  )
  const { options: campagneOptions, loading: campagneLoading } =
    useRefRecordOptions(w, campagneTableId)
  const campagneLabelById = useMemo(
    () => new Map(campagneOptions.map((o) => [o.id, o.label])),
    [campagneOptions]
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
              campagneLabel={
                activeTask.campagne != null
                  ? (campagneLabelById.get(activeTask.campagne) ??
                    `#${activeTask.campagne}`)
                  : null
              }
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
            campagneOptions={campagneOptions}
            campagneLoading={campagneLoading}
            gereParKind={gereParKind}
            gereParChoices={gereParChoices}
            gereParOptions={gereParOptions}
            gereParLoading={gereParLoading}
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
