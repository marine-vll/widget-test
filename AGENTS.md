# Agent guide — start here

> Audience: an agent working inside a widget repo scaffolded from
> `create-grist-widget` (this file travels with the scaffold), or working on
> this template's own source under
> `templates/grist-widget-template-vite/` inside the `grist-widget-sdk`
> monorepo. This repo is a **distribution artifact** — `main` is force-pushed
> from a fresh scaffold on every release, not developed on directly upstream.
> If you're in the monorepo working on the SDK itself, read the root
> `AGENTS.md` instead.

## The widget contract

`src/App.tsx` is the whole widget — one file, three exports:

```tsx
export const GRIST_OPTIONS: UseGristOptions = { requiredAccess: "read table" }
export const WIDGET_METADATA = { title: "...", description: "..." } as const
export function App() {
  const w = useGrist()
  // ...
}
```

`src/main.tsx` wires it into Grist: `GristWidgetProvider` (reads `GRIST_OPTIONS`) →
`GristBoundary` → `GristSdkAlerts` → `<App />`. Access level, column mapping, and
rendering all live in `src/App.tsx` — that's the one file to edit.

## Operating contract

1. **Widgets use the SDK.** No direct `window.grist.*` calls — use `useGrist()` and the
   other `grist-widget-sdk` hooks.
2. **`pnpm dev` is a bare shell, on purpose — not a seeded preview.** Opened outside Grist
   it renders `LocalDevNotice`; the widget itself only renders once actually embedded in a
   Grist document. This is deliberate, not a gap: an emulator can't guarantee parity with
   real Grist, so a fake local preview would teach the wrong lesson. Trust `pnpm test`
   (headless, real assertions) for local feedback, and the `dev`-branch loop below for real
   behavior — don't build or suggest a seeded `pnpm dev` preview.
3. **Widget changes get a test.** `src/App.test.tsx` uses `renderWithGrist` + `presets` from
   `grist-widget-sdk/emulator/testing` — no browser or real Grist doc needed. Run `pnpm test`.
4. **Always develop on `dev`, release by merging to `main`.** Commit and push to `dev` for
   every change — it auto-deploys a live preview at `.../dev/` that self-reloads inside an
   open Grist document a few seconds later. Bump `package.json`'s `version` *before*
   opening the `dev` → `main` PR: merging without a version bump publishes nothing (the
   release build silently no-ops whenever that version's directory already exists — the PR
   merges cleanly and CI reports success either way).

## Commands

| Intent | Command |
| --- | --- |
| Install | `pnpm install` |
| Dev server (bare shell outside Grist, pointing at the `dev` loop) | `pnpm dev` |
| Build | `pnpm build` |
| Test | `pnpm test` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Type-check | `pnpm typecheck` |
| Preview a production build | `pnpm preview` |

## Path map

| Concept | Path |
| --- | --- |
| The widget | `src/App.tsx` |
| Widget test (the pattern to copy for new tests) | `src/App.test.tsx` |
| Grist wiring / embed vs. showcase detection | `src/main.tsx` |
| ui primitives | `src/components/ui/` |
| Deploy workflow | `.github/workflows/deploy.yml` |
| Deploy script (version guard, channel logic) | `scripts/deploy.mjs` |
| Full walkthrough (dev loop, deploying, embedding) | `README.md` |
| Changelog | `CHANGELOG.md` |

## One-time repo settings

Only needed once, after the first push triggers the deploy workflow's first run (it
creates a `gh-pages` branch — these settings can't be applied before that exists):

1. Settings → Pages → Source → **Deploy from a branch** → branch `gh-pages`, folder
   `/ (root)`. Not `main` — pointing Pages at `main` serves this repo's raw, unbuilt source
   instead of the built site (symptom: a blank page with a `/src/main.tsx` 404).
2. If that first workflow run fails with a permissions error pushing to `gh-pages`:
   Settings → Actions → General → Workflow permissions → **Read and write permissions**.
   Most repos don't need this; it depends on account/org defaults.

Full detail, including the two live URLs (`/latest/` and `/v<version>/`): `README.md`.

## Anti-patterns

- Calling `window.grist.*` inside widget code instead of the SDK's hooks
- Building or describing a seeded/live `pnpm dev` preview — deliberately not how this
  template works (see above); `pnpm test` is the trusted local loop, real Grist via `/dev/`
  is the trusted real one
- Merging `dev` into `main` without bumping `package.json`'s `version` first
