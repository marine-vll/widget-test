/**
 * Mirrors `main.tsx`'s real wiring (`GristWidgetProvider` -> `GristBoundary`
 * -> the widget) without importing `main.tsx` itself, so this test exercises
 * the same gate logic the embedded widget actually runs under. See
 * `packages/core/tests/sdk/template-app.test.tsx` in the SDK repo for the
 * same pattern applied to a bare shell.
 */
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  GristBoundary,
  GristWidgetProvider,
  type GristReplicaDocument,
} from "grist-widget-sdk"
import {
  act,
  actionsOf,
  cleanup,
  fireEvent,
  renderWithGrist,
  screen,
  waitFor,
  within,
} from "grist-widget-sdk/emulator/testing"

import {
  encodeTaskPatch,
  findUnmappedColumns,
  mapTaskRow,
  resolveDropTarget,
  resolveRefOptionId,
} from "@/lib/grist-kanban"

import App, { GRIST_OPTIONS } from "./App"

afterEach(() => cleanup())

// Local fixture instead of `presets.*`: the Kanban widget needs a Choice
// column with configured `widgetOptions.choices` (drives the columns), a
// ChoiceList column, and a Ref column pointing at a second table — none of
// the built-in presets model that shape.
function kanbanFixture(): GristReplicaDocument {
  return {
    generatedAt: "1970-01-01T00:00:00.000Z",
    docName: "Suivi campagnes",
    mode: "schema+data",
    tables: {
      Tasks: {
        label: "Tasks",
        columns: {
          STATUT: {
            type: "Choice",
            label: "Statut",
            widgetOptions: { choices: ["A faire", "En cours", "Terminé"] },
          },
          TITRE: { type: "Text", label: "Titre" },
          CAMPAGNE: { type: "Ref:Campagnes", label: "Campagne" },
          DATE_DEBUT: { type: "Date", label: "Date début" },
          DATE_FIN: { type: "Date", label: "Date fin" },
          SERVICE: { type: "Text", label: "Service" },
          TYPE: {
            type: "ChoiceList",
            label: "Type",
            widgetOptions: { choices: ["Réunion", "Formation"] },
          },
          COMMENTAIRES: { type: "Text", label: "Commentaires" },
          CREE_PAR: { type: "Text", label: "Créé par" },
          // Modeled as a single Choice here (as opposed to TYPE's ChoiceList)
          // specifically to exercise the adaptive field's "choice" branch —
          // real documents may map either shape to this logical field.
          GERE_PAR: {
            type: "Choice",
            label: "Géré par l'équipe",
            widgetOptions: { choices: ["Équipe A", "Équipe B"] },
          },
        },
        rows: [
          {
            id: 1,
            STATUT: "A faire",
            TITRE: "Préparer le kickoff",
            CAMPAGNE: 1,
            DATE_DEBUT: Math.floor(Date.UTC(2026, 0, 5) / 1000),
            DATE_FIN: Math.floor(Date.UTC(2026, 0, 10) / 1000),
            SERVICE: "Communication",
            TYPE: ["Réunion"],
            COMMENTAIRES: "",
            CREE_PAR: "Marine",
            GERE_PAR: "Équipe A",
          },
          {
            id: 2,
            STATUT: "En cours",
            TITRE: "Rédiger le bilan",
            CAMPAGNE: null,
            DATE_DEBUT: null,
            DATE_FIN: null,
            SERVICE: "",
            TYPE: [],
            COMMENTAIRES: "",
            CREE_PAR: "",
            GERE_PAR: "",
          },
        ],
      },
      Campagnes: {
        label: "Campagnes",
        columns: { NOM: { type: "Text", label: "Nom" } },
        rows: [
          { id: 1, NOM: "Campagne Alpha" },
          { id: 2, NOM: "Campagne Beta" },
        ],
      },
    },
  }
}

const MAPPINGS = {
  statut: "STATUT",
  titre: "TITRE",
  campagne: "CAMPAGNE",
  dateDebut: "DATE_DEBUT",
  dateFin: "DATE_FIN",
  service: "SERVICE",
  type: "TYPE",
  commentaires: "COMMENTAIRES",
  creePar: "CREE_PAR",
  gerePar: "GERE_PAR",
}

// Reproduces the live bug report: "Campagne" mapped to "Campagne_Nom", a
// formula column (type "Any") that returns the linked record's name as
// plain text -- not an actual Ref/RefList column.
function misconfiguredCampagneFixture(): GristReplicaDocument {
  return {
    generatedAt: "1970-01-01T00:00:00.000Z",
    docName: "Suivi campagnes",
    mode: "schema+data",
    tables: {
      Tasks: {
        label: "Tasks",
        columns: {
          STATUT: {
            type: "Choice",
            label: "Statut",
            widgetOptions: { choices: ["A faire"] },
          },
          TITRE: { type: "Text", label: "Titre" },
          CAMPAGNE_NOM: {
            type: "Any",
            isFormula: true,
            label: "Campagne_Nom",
          },
        },
        rows: [
          {
            id: 1,
            STATUT: "A faire",
            TITRE: "Réalisation de vidéos courtes",
            CAMPAGNE_NOM: "France Botswana Forward",
          },
        ],
      },
    },
  }
}

// Reproduces the other live report: mapped to "Campagnes", a genuine
// Ref:Campagnes column -- but Grist (`keepEncoded: false`) delivers the
// linked record's *display text*, not its row id.
function refDeliveredAsTextFixture(): GristReplicaDocument {
  return {
    generatedAt: "1970-01-01T00:00:00.000Z",
    docName: "Suivi campagnes",
    mode: "schema+data",
    tables: {
      Tasks: {
        label: "Tasks",
        columns: {
          STATUT: {
            type: "Choice",
            label: "Statut",
            widgetOptions: { choices: ["A faire"] },
          },
          TITRE: { type: "Text", label: "Titre" },
          CAMPAGNE: { type: "Ref:Campagnes", label: "Campagne" },
        },
        rows: [
          {
            id: 1,
            STATUT: "A faire",
            TITRE: "Diffusion sur smartvillage.africa",
            CAMPAGNE: "Campagne Beta",
          },
        ],
      },
      Campagnes: {
        label: "Campagnes",
        columns: { NOM: { type: "Text", label: "Nom" } },
        rows: [
          { id: 1, NOM: "Campagne Alpha" },
          { id: 2, NOM: "Campagne Beta" },
        ],
      },
    },
  }
}

function Wrapped() {
  return (
    <GristWidgetProvider options={GRIST_OPTIONS}>
      <GristBoundary
        gate={GRIST_OPTIONS.columns?.length ? "canRender" : "ready"}
      >
        <App />
      </GristBoundary>
    </GristWidgetProvider>
  )
}

function renderBoard() {
  const result = renderWithGrist(<Wrapped />, {
    emulator: { document: kanbanFixture() },
  })
  result.emulator.setColumnMappings(MAPPINGS)
  return result
}

describe("App", () => {
  it("does not show the unmapped-columns notice once every field is mapped", async () => {
    renderBoard()

    await waitFor(() => screen.getByText("Préparer le kickoff"))
    expect(screen.queryByText(/pas encore associées/)).not.toBeInTheDocument()
  })

  it("flags logical fields left unmapped in Grist's own config panel", async () => {
    const { emulator } = renderWithGrist(<Wrapped />, {
      emulator: { document: kanbanFixture() },
    })
    // Only Statut/Titre mapped -- every optional field (Campagne, dates,
    // Service, Type, Créé par, Géré par) is left unset, exactly like a
    // widget instance whose config panel was never fully filled in. This is
    // the scenario that makes those fields read as empty even though the
    // underlying Grist columns have data.
    emulator.setColumnMappings({ statut: "STATUT", titre: "TITRE" })

    await waitFor(() => screen.getByText("Préparer le kickoff"))
    // dnd-kit also renders its own (unrelated) `role="status"` live region,
    // so target the notice by its text rather than by role.
    const notice = screen.getByText(/pas encore associées/).closest("p")!
    expect(notice).toHaveTextContent("Campagne")
    expect(notice).toHaveTextContent("Créé par")
    expect(notice).toHaveTextContent("Géré par l'équipe")
  })

  it("builds one Kanban column per Statut choice and sorts cards into them", async () => {
    renderBoard()

    await waitFor(() => {
      expect(screen.getByText("A faire")).toBeInTheDocument()
      expect(screen.getByText("En cours")).toBeInTheDocument()
      expect(screen.getByText("Terminé")).toBeInTheDocument()
    })

    expect(screen.getByText("Préparer le kickoff")).toBeInTheDocument()
    expect(screen.getByText("Rédiger le bilan")).toBeInTheDocument()
  })

  it("opens an existing task and groups fields exactly per the requested layout", async () => {
    renderBoard()

    await waitFor(() => screen.getByText("Préparer le kickoff"))
    fireEvent.click(screen.getByText("Préparer le kickoff"))

    await waitFor(() =>
      expect(screen.getByLabelText("Titre")).toHaveValue("Préparer le kickoff")
    )

    // Ligne 1 : Campagne (référence résolue vers son libellé)
    expect(screen.getByLabelText("Campagne")).toHaveValue("1")
    expect(
      within(screen.getByLabelText("Campagne")).getByText("Campagne Alpha")
    ).toBeInTheDocument()
    // Ligne 3 : dates
    expect(screen.getByLabelText("Date début")).toHaveValue("2026-01-05")
    expect(screen.getByLabelText("Date fin")).toHaveValue("2026-01-10")
    // Ligne 4 : service + géré par l'équipe
    expect(screen.getByLabelText("Service responsable")).toHaveValue(
      "Communication"
    )
    expect(screen.getByLabelText("Géré par l'équipe")).toHaveValue("Équipe A")
    // Ligne 4bis : type (choice list -> cases à cocher)
    expect(screen.getByRole("checkbox", { name: "Réunion" })).toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: "Formation" })
    ).not.toBeChecked()
    // Ligne 6 : statut + créé par
    expect(screen.getByLabelText("Statut")).toHaveValue("A faire")
    expect(screen.getByLabelText("Créé par")).toHaveValue("Marine")
    // Ligne 7 : les deux actions sont côte à côte
    expect(screen.getByRole("button", { name: /Valider/ })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Supprimer/ })
    ).toBeInTheDocument()
  })

  it("saves an edited task back to Grist with the real column ids", async () => {
    const { emulator } = renderBoard()

    await waitFor(() => screen.getByText("Rédiger le bilan"))
    fireEvent.click(screen.getByText("Rédiger le bilan"))
    await waitFor(() =>
      expect(screen.getByLabelText("Titre")).toHaveValue("Rédiger le bilan")
    )

    fireEvent.change(screen.getByLabelText("Titre"), {
      target: { value: "Rédiger le bilan final" },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Valider/ }))
    })

    await waitFor(() => {
      const [, , , fields] = actionsOf(emulator).find(
        (a) => a[0] === "UpdateRecord" && a[2] === 2
      ) as [string, string, number, Record<string, unknown>]
      expect(fields.TITRE).toBe("Rédiger le bilan final")
    })
  })

  it("creates a new task from the top-level button", async () => {
    const { emulator } = renderBoard()

    await waitFor(() => screen.getByText("Ajouter une action"))
    fireEvent.click(screen.getByText("Ajouter une action"))

    await waitFor(() => screen.getByLabelText("Titre"))
    fireEvent.change(screen.getByLabelText("Titre"), {
      target: { value: "Nouvelle campagne presse" },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Valider/ }))
    })

    await waitFor(() => {
      expect(actionsOf(emulator)).toContainEqual(
        expect.arrayContaining([
          "AddRecord",
          "Tasks",
          null,
          expect.objectContaining({
            TITRE: "Nouvelle campagne presse",
            STATUT: "A faire",
          }),
        ])
      )
    })
  })

  it("filters cards by Géré par l'équipe", async () => {
    renderBoard()

    await waitFor(() => screen.getByText("Préparer le kickoff"))
    expect(screen.getByText("Rédiger le bilan")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Équipe A" }))
    await waitFor(() =>
      expect(screen.queryByText("Rédiger le bilan")).not.toBeInTheDocument()
    )
    expect(screen.getByText("Préparer le kickoff")).toBeInTheDocument()

    // Clicking the active filter again clears it.
    fireEvent.click(screen.getByRole("button", { name: "Équipe A" }))
    await waitFor(() =>
      expect(screen.getByText("Rédiger le bilan")).toBeInTheDocument()
    )
  })

  it("shows Campagne as a #tag badge on the card when it's plain text (e.g. a computed column)", async () => {
    renderWithGrist(<Wrapped />, {
      emulator: { document: misconfiguredCampagneFixture() },
    }).emulator.setColumnMappings({
      statut: "STATUT",
      titre: "TITRE",
      campagne: "CAMPAGNE_NOM",
    })

    await waitFor(() =>
      expect(screen.getByText("#France Botswana Forward")).toBeInTheDocument()
    )
  })

  it("keeps Campagne editable-looking (not a scary error) but disabled when the mapped column is a Grist formula, and never writes to it", async () => {
    const { emulator } = renderWithGrist(<Wrapped />, {
      emulator: { document: misconfiguredCampagneFixture() },
    })
    emulator.setColumnMappings({
      statut: "STATUT",
      titre: "TITRE",
      campagne: "CAMPAGNE_NOM",
    })

    await waitFor(() => screen.getByText("Réalisation de vidéos courtes"))
    fireEvent.click(screen.getByText("Réalisation de vidéos courtes"))

    // Same widget-level field as an editable Campagne would use (a real,
    // labeled control) -- just disabled, since Grist would reject a write
    // to a formula column regardless of what the UI offers.
    await waitFor(() =>
      expect(screen.getByLabelText("Campagne")).toHaveValue(
        "France Botswana Forward"
      )
    )
    expect(screen.getByLabelText("Campagne")).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Titre"), {
      target: { value: "Réalisation de vidéos courtes (v2)" },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Valider/ }))
    })

    await waitFor(() => {
      const [, , , fields] = actionsOf(emulator).find(
        (a) => a[0] === "UpdateRecord" && a[2] === 1
      ) as [string, string, number, Record<string, unknown>]
      expect(fields.TITRE).toBe("Réalisation de vidéos courtes (v2)")
      expect(fields).not.toHaveProperty("CAMPAGNE_NOM")
    })
  })

  it("pre-selects the right Campagne even when the real Ref column delivers display text instead of a row id", async () => {
    const { emulator } = renderWithGrist(<Wrapped />, {
      emulator: { document: refDeliveredAsTextFixture() },
    })
    emulator.setColumnMappings({
      statut: "STATUT",
      titre: "TITRE",
      campagne: "CAMPAGNE",
    })

    await waitFor(() => screen.getByText("Diffusion sur smartvillage.africa"))
    fireEvent.click(screen.getByText("Diffusion sur smartvillage.africa"))

    await waitFor(() =>
      expect(screen.getByLabelText("Campagne")).toHaveValue("2")
    )
    expect(
      within(screen.getByLabelText("Campagne")).getByText("Campagne Beta")
    ).toBeInTheDocument()

    // Picking a different campaign now writes its real row id, not text.
    fireEvent.change(screen.getByLabelText("Campagne"), {
      target: { value: "1" },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Valider/ }))
    })

    await waitFor(() => {
      const [, , , fields] = actionsOf(emulator).find(
        (a) => a[0] === "UpdateRecord" && a[2] === 1
      ) as [string, string, number, Record<string, unknown>]
      expect(fields.CAMPAGNE).toBe(1)
    })
  })

  it("deletes a task", async () => {
    const { emulator } = renderBoard()

    await waitFor(() => screen.getByText("Préparer le kickoff"))
    fireEvent.click(screen.getByText("Préparer le kickoff"))
    await waitFor(() => screen.getByRole("button", { name: /Supprimer/ }))

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }))
    })

    await waitFor(() => {
      expect(actionsOf(emulator)).toContainEqual(["RemoveRecord", "Tasks", 1])
    })
  })
})

describe("findUnmappedColumns", () => {
  it("lists optional fields with no real column assigned", () => {
    const spec = [
      { name: "statut", title: "Statut" },
      { name: "titre", title: "Titre" },
      { name: "campagne", title: "Campagne", optional: true },
      { name: "creePar", title: "Créé par", optional: true },
    ]
    const gaps = findUnmappedColumns(
      { statut: "STATUT", titre: "TITRE", campagne: undefined, creePar: "" },
      spec
    )
    expect(gaps).toEqual([
      { name: "campagne", title: "Campagne" },
      { name: "creePar", title: "Créé par" },
    ])
  })

  it("returns nothing when every field has a real column", () => {
    const spec = [{ name: "statut", title: "Statut" }]
    expect(findUnmappedColumns({ statut: "STATUT" }, spec)).toEqual([])
  })
})

describe("mapTaskRow / encodeTaskPatch", () => {
  it("reads Campagne from a RefList column (not just a plain Ref)", () => {
    // Some documents model a "linked to one or more records" column as
    // RefList rather than Ref.
    const task = mapTaskRow(
      { id: 1, CAMPAGNE: [3, 5] },
      { campagne: "CAMPAGNE" },
      { campagne: { type: "RefList:Campagnes" } }
    )
    expect(task.campagne).toEqual(["3", "5"])
  })

  it("writes Campagne back as a list when the column is RefList", () => {
    const fields = encodeTaskPatch(
      { campagne: ["7"] },
      { campagne: { type: "RefList:Campagnes" } }
    )
    expect(fields.campagne).toEqual(["L", 7])
  })

  it("reads Campagne as plain text when mapped to a computed column instead of a real reference", () => {
    // The exact shape found live: "Campagne_Nom" turned out to be a formula
    // column (type "Any", isFormula: true) returning the linked record's
    // name as plain text, not the reference itself -- like kanban2's own
    // "reference" field, this is accepted as-is rather than rejected.
    const task = mapTaskRow(
      { id: 1, CAMPAGNE_NOM: "France Botswana Forward" },
      { campagne: "CAMPAGNE_NOM" },
      {
        campagne: {
          type: "Any",
          isFormula: true,
          label: "Campagne_Nom",
        },
      }
    )
    expect(task.campagne).toEqual(["France Botswana Forward"])
  })

  it("reads a genuine Reference column even when Grist delivers its display text instead of a row id", () => {
    // `grist.onRecords(..., { keepEncoded: false })` -- what this widget
    // uses -- resolves a Reference cell to the linked record's rendered
    // text, not its row id. A real "Ref:Campagnes" column can show up with
    // exactly this shape; it must not be treated as "no data".
    const task = mapTaskRow(
      { id: 1, CAMPAGNE: "France Botswana Forward" },
      { campagne: "CAMPAGNE" },
      { campagne: { type: "Ref:Campagnes" } }
    )
    expect(task.campagne).toEqual(["France Botswana Forward"])
  })

  it("omits Campagne from the write-back patch instead of sending NaN when it's still unresolved display text", () => {
    // The form only ever produces a real row id once the user has actually
    // picked something from the (fetched) options list; until then, an
    // untouched Ref field is still holding the display text it was read as.
    const fields = encodeTaskPatch(
      { campagne: ["France Botswana Forward"] },
      { campagne: { type: "Ref:Campagnes" } }
    )
    expect(fields).not.toHaveProperty("campagne")
  })

  it("decodes a Date cell delivered as a native Date instance, even with no schema loaded yet", () => {
    // Confirmed live via the console diagnostic: `grist.onRecords(...,
    // { keepEncoded: false })` hands Date/DateTime cells over as an actual
    // `Date` object -- decodeGristValue has no "already a Date" branch, so
    // it silently discards it (falls through to `return null`) unless this
    // is caught on the raw value first.
    const target = new Date("2026-07-20T00:00:00.000Z")
    const task = mapTaskRow(
      { id: 1, DATE_FIN: target },
      { dateFin: "DATE_FIN" },
      {} // schema not loaded yet -- matches the exact live diagnostic (schema: undefined)
    )
    expect(task.dateFin).toEqual(target)
  })

  it("decodes a Date cell delivered as a moment.js-like object", () => {
    // Defensive fallback for hosts/paths that deliver a moment instance
    // instead of a native Date -- decodeGristValue doesn't recognize that
    // shape either (neither a marshalled tuple nor a plain epoch number).
    const target = new Date(Date.UTC(2026, 6, 30))
    const momentLike = { toDate: () => target }
    const task = mapTaskRow(
      { id: 1, DATE_FIN: momentLike },
      { dateFin: "DATE_FIN" },
      { dateFin: { type: "Date" } }
    )
    expect(task.dateFin).toEqual(target)
  })

  it("decodes a Date cell even when no column schema is available yet", () => {
    // buildColumnSchemas() can legitimately return `{}` for a render before
    // the schema fetch resolves; the date should still come through as a
    // real Date rather than silently dropping to null.
    const epochSeconds = Math.floor(Date.UTC(2026, 2, 15) / 1000)
    const task = mapTaskRow(
      { id: 1, DATE_FIN: epochSeconds },
      { dateFin: "DATE_FIN" },
      {}
    )
    expect(task.dateFin).toEqual(new Date(epochSeconds * 1000))
  })

  it("does not warn about an empty ChoiceList sent as the marshalled ['L'] tuple", () => {
    // Caught by this exact test while wiring up the decode-failure
    // diagnostic: Grist represents an *empty* ChoiceList/RefList cell as the
    // tag-only tuple `["L"]`, not a plain `[]` -- a naive "is this array
    // empty" check misreads that as "there was data" and fires a false
    // "failed to decode" warning for a column with no data at all.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const task = mapTaskRow(
      { id: 2, TYPE: ["L"] },
      { type: "TYPE" },
      { type: { type: "ChoiceList", widgetOptions: { choices: ["Réunion"] } } }
    )
    expect(task.type).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("resolveDropTarget", () => {
  it("resolves the target Statut from the droppable's data", () => {
    expect(
      resolveDropTarget({
        active: { id: 1 },
        over: { id: "En cours", data: { current: { statut: "En cours" } } },
      })
    ).toEqual({ taskId: 1, statut: "En cours" })
  })

  it("falls back to the over id when no statut data is attached", () => {
    expect(
      resolveDropTarget({
        active: { id: 3 },
        over: { id: "Terminé", data: {} },
      })
    ).toEqual({
      taskId: 3,
      statut: "Terminé",
    })
  })

  it("returns null when dropped outside any droppable", () => {
    expect(resolveDropTarget({ active: { id: 1 }, over: null })).toBeNull()
  })
})

describe("resolveRefOptionId", () => {
  const options = [
    { id: 1, label: "Campagne Alpha" },
    { id: 2, label: "Campagne Beta" },
  ]

  it("matches by id when the value is already a resolvable row id", () => {
    expect(resolveRefOptionId("2", options)).toBe(2)
  })

  it("falls back to matching by label when the value is display text", () => {
    // The shape `keepEncoded: false` actually delivers for a Reference cell.
    expect(resolveRefOptionId("Campagne Beta", options)).toBe(2)
  })

  it("returns null when nothing matches", () => {
    expect(resolveRefOptionId("Campagne inconnue", options)).toBeNull()
  })
})
