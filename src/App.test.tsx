/**
 * Mirrors `main.tsx`'s real wiring (`GristWidgetProvider` -> `GristBoundary`
 * -> the widget) without importing `main.tsx` itself, so this test exercises
 * the same gate logic the embedded widget actually runs under. See
 * `packages/core/tests/sdk/template-app.test.tsx` in the SDK repo for the
 * same pattern applied to a bare shell.
 */
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"
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

import { resolveDropTarget } from "@/lib/grist-kanban"

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
    // Ligne 4 : service + type
    expect(screen.getByLabelText("Service responsable")).toHaveValue(
      "Communication"
    )
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

    await waitFor(() => screen.getByText("Nouvelle tâche"))
    fireEvent.click(screen.getByText("Nouvelle tâche"))

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
