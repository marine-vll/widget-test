/**
 * Mirrors `main.tsx`'s real wiring (`GristWidgetProvider` -> `GristBoundary`
 * -> the widget) without importing `main.tsx` itself, so this test exercises
 * the same gate logic the embedded widget actually runs under. See
 * `packages/core/tests/sdk/template-app.test.tsx` in the SDK repo for the
 * same pattern applied to a bare shell.
 */
import "@testing-library/jest-dom/vitest"
import { afterEach, describe, expect, it } from "vitest"
import { GristBoundary, GristWidgetProvider } from "grist-widget-sdk"
import {
  act,
  actionsOf,
  cleanup,
  fireEvent,
  presets,
  renderWithGrist,
  screen,
  waitFor,
} from "grist-widget-sdk/emulator/testing"

import App, { GRIST_OPTIONS } from "./App"

// Not using vitest's `globals: true` (see vite.config.ts), so
// @testing-library/react's automatic afterEach cleanup never registers
// itself — do it explicitly, or the second test in this file finds two
// "Title" inputs left over from the first render.
afterEach(() => cleanup())

function Wrapped() {
  return (
    <GristWidgetProvider options={GRIST_OPTIONS}>
      <GristBoundary gate={GRIST_OPTIONS.columns?.length ? "canRender" : "ready"}>
        <App />
      </GristBoundary>
    </GristWidgetProvider>
  )
}

describe("App", () => {
  it("shows the selected row's mapped title and done state", async () => {
    const { emulator } = renderWithGrist(<Wrapped />, {
      emulator: { document: presets.todoList() },
    })
    // `columns` in GRIST_OPTIONS names the widget's own logical fields — a
    // real Grist host maps them to real column ids via the config panel;
    // the emulator needs the same mapping told to it explicitly (name
    // matching alone doesn't auto-map, here or in real Grist).
    emulator.setColumnMappings({ title: "title", done: "done" })

    await waitFor(() => {
      expect(screen.getByLabelText("Title")).toHaveValue("Buy milk")
      expect(screen.getByLabelText("Mark as done")).not.toBeChecked()
    })
  })

  it("saves an edited title back to Grist", async () => {
    const { emulator } = renderWithGrist(<Wrapped />, {
      emulator: { document: presets.todoList() },
    })
    emulator.setColumnMappings({ title: "title", done: "done" })

    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Buy milk"))

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Buy oat milk" },
    })
    await act(async () => {
      fireEvent.click(screen.getByText("Save"))
    })

    await waitFor(() => {
      expect(actionsOf(emulator)).toContainEqual([
        "UpdateRecord",
        "Tasks",
        1,
        { title: "Buy oat milk", done: false },
      ])
    })
  })
})
