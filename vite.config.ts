import { readFileSync } from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
// `vitest/config`'s defineConfig is a superset of vite's own -- same build
// config still works, and it adds the `test` field below. Importing it here
// (rather than a separate vitest.config.ts) means `pnpm test` reuses this
// file's `@` alias and plugins instead of duplicating them.
import { defineConfig } from "vitest/config"

// Read here (Node context) rather than importing package.json into src/ --
// keeps the whole file out of the bundle, exposing only the one field the
// landing page footer needs.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __CREATE_GRIST_WIDGET_VERSION__: JSON.stringify(pkg.createGristWidgetVersion ?? null),
  },
  test: {
    environment: "jsdom",
    // Most examples/<id>/ don't ship their own WidgetApp.test.tsx yet (it's
    // optional, per docs/planning/2026-08-execution-plan.md §3) --
    // overlayExampleSrc correctly deletes the template's own App.test.tsx
    // when swapping in one that has none (it would otherwise assert against
    // content that's no longer there), so `create --example <id>` / `use
    // <id>` routinely leave a project with zero test files. Without this,
    // `pnpm test` exits 1 ("No test files found") on every one of those --
    // a project that legitimately has no tests yet should report green, not
    // red. Found live testing the real published create-grist-widget@0.3.9.
    passWithNoTests: true,
  },
})
