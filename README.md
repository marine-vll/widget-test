# grist-widget-template

Base template to build a Grist widget with `grist-widget-sdk`.

`src/main.tsx` wraps the app with `GristWidgetProvider`, `GristBoundary`, and `GristSdkAlerts`. The latter maps `getGristSdkAlertDescriptors()` from the SDK to shadcn `Alert` (`src/components/grist-sdk-alerts.tsx` + `src/components/ui/alert.tsx`); keep them in sync with the playground when you change alert styling.

Opened outside a Grist iframe, `main.tsx` picks between two components — never a live preview of the widget itself, since nothing here proves anything about real Grist behavior: local `pnpm dev` renders `LocalDevNotice`, a bare shell pointing at the real verification loop below (push to `dev`, open it in a real Grist document); any built/deployed URL (root, `/latest/`, `/dev/`, `/v<version>/` — all carrying the same build, see Deployment below) renders `ReleaseInfo` instead — which build this is, chips to jump to any other version/channel (hover one to see when it shipped; `src/lib/showcase-versions.ts`), and a copy-this-URL helper for pasting into Grist's custom widget field.

When actually embedded, `GristStatusChip` (`src/components/grist-status-chip.tsx`) shows a small pill with live handshake status — connecting, retrying with a countdown, connected, or unavailable — using `useAmbientGristHandshake()` from `grist-widget-sdk/advanced`. It must be mounted *inside* `GristWidgetProvider` (see `src/main.tsx`): it only observes that provider's own handshake manager and never mounts a second one, so it's purely observational and can never duplicate or race the real handshake (see the [handshake API reference](https://gristwidgets.com/docs/sdk/api/handshake)).

`src/App.tsx` uses `useGrist<TaskRow, TaskMapped>()` for the selected row (`w.record`, `w.mode`) and remounts the UI with `key={rowKey}` when the row changes — same pattern as `widgets/create-email-draft`. It ships with two mapped columns (`title`, `done`) and an editable form that saves back via `w.table.update(...)`/`w.mapBack(...)` — the smallest real starting point, not a placeholder. See `src/grist-types.example.ts` for typing patterns.

- **ESLint** blocks direct `grist` global usage in `src/` — use the SDK only.
- Edit `GRIST_OPTIONS.columns` in `App.tsx` to change the required columns (or remove the array entirely to read raw, unmapped records instead); `main.tsx` sets `GristBoundary gate="canRender"` whenever columns are declared. Mapping alerts use `GristSdkAlerts`.

Run `pnpm test` — see `src/App.test.tsx` for the pattern (`renderWithGrist` + `presets` from `grist-widget-sdk/emulator/testing`, no browser or real Grist doc needed). Full guide: [Testing](https://gristwidgets.com/docs/emulator/testing).

**Monorepo dev:** this template resolves `grist-widget-sdk` from `packages/core/dist` (like the other widgets), not from SDK source. After changing the SDK, run `pnpm prebuild` or `pnpm --filter grist-widget-sdk build` before `pnpm dev`.

## How this template is distributed

This is the **source** template. It is consumed two ways:

- **In the SDK monorepo (development):** it's a workspace member and depends on
  the SDK via `"grist-widget-sdk": "workspace:^"`, resolved from
  `packages/core/dist`. Run `pnpm --filter grist-widget-sdk build` after
  changing the SDK, then `pnpm dev` here.
- **Externally (your own repo):** the `create-grist-widget` CLI
  (`npm create grist-widget my-widget`) copies this template and rewrites the
  dependency to the published npm range (`^0.x`), so nothing points back at
  this repo. See [Quickstart](https://gristwidgets.com/docs/quickstart).

`pnpm-workspace.yaml` here only pre-approves esbuild's build script so a
standalone `pnpm install` (pnpm 11) exits cleanly; inside the monorepo it's
ignored (the root workspace governs).

### Live preview

This template has no live-preview deploy of its own inside this monorepo —
that used to exist (a `/template/` showcase on this repo's own GitHub
Pages) but has been retired. The only live preview of this template's
current source is external: `template-canary.yml` scaffolds it via the
*published* `create-grist-widget` package and pushes to the `dev` branch
(pre-release preview) and directly to `main` (stable `@latest`, promotion is
automatic) of
[`grist-widget-template`](https://github.com/ArthurBlanchon/grist-widget-template)
after every release — see https://gristwidgets.com/docs/contributing/releasing for the full
mechanism. There is no live preview of *unreleased* changes to this
template; to try one locally, scaffold from your working tree with
`pnpm --filter create-grist-widget build` (embeds this template verbatim —
see `scripts/build-template.mjs`) and run the packed CLI against a scratch
directory, same as `scripts/smoke/create-widget.sh` does.

## Deployment

A bundled GitHub Actions workflow (`.github/workflows/deploy.yml` +
`scripts/deploy.mjs`) publishes this widget to **your own** GitHub Pages.

### The workflow: always develop on `dev`, release by merging to `main`

1. Commit and push to the `dev` branch (created for you at scaffold time).
   Every push auto-deploys a live preview at `/dev/` that self-reloads
   inside an open Grist document a few seconds later — paste that URL into
   a Grist doc once, then just keep pushing while you iterate.
2. Ready to publish a release? **Bump `package.json`'s `version`** as part
   of your `dev` branch changes, then open a PR from `dev` into `main`.
3. **Merge the PR.** This is the step that actually publishes — merging to
   `main` builds immutable `/v<version>/` and updates mutable `/latest/`.

> ⚠️ **Merging without bumping the version publishes nothing.** The release
> build is idempotent — it skips whenever `package.json`'s version already
> has a matching `v<version>/` directory published, which is always true if
> you forgot to bump it (it'll match whatever's already live). The PR merges
> cleanly and CI runs "successfully," but `/latest/` silently stays exactly
> as it was. Bump the version *before* merging, not after.

After merging, keep committing to the same `dev` branch for your next round
of changes — it's the permanent working/preview branch for this widget, not
a one-off feature branch to delete and recreate. Deleting it retires `/dev/`
automatically.

> ⚠️ **Used GitHub's "Use this template" button instead of `npm create
> grist-widget`?** That path copies this repo's default branch verbatim —
> it doesn't run any of the CLI's own setup (renaming `package.json`,
> titles, etc.), and whatever version happens to be checked into the
> source repo's `package.json` (which can be well past `0.0.1`) comes along
> with it. **The moment the repo is created, GitHub's own initial push to
> `main` fires this workflow and publishes a clean `v0.0.1`** — your first
> release always resolves to `v0.0.1` regardless of what `package.json`
> says, so `/`, `/latest/`, and `/v0.0.1/` all go live right away (once
> you've done the one-time Pages setup below). You don't reset the version
> by hand: on that first release the pipeline also **rewrites
> `package.json`'s version back to `0.0.1` in the repo itself** (a commit it
> pushes to `main`/`dev`), so your *next* release naturally bumps to
> `0.0.2` instead of jumping to whatever inherited number you started with.
> If you also checked **"Include all branches"** (to get `gh-pages`/Pages
> already set up, no manual Settings step), that first release also clears
> out every leftover bit of inherited content it finds — stray
> `v<version>/` dirs, and a root/`latest/` still pointing at the *source*
> repo's own path — before writing its own. A `v<version>/` only counts as
> a genuine prior release once it carries a `showcase-meta.json` naming
> *this* repo, so on a repo with no genuine releases yet, everything else is
> provably inherited noise and gets safely replaced. On that same first
> release, every branch except `main`, `dev`, and `gh-pages` is pruned and
> `dev` is force-reset to match `main`'s tip — a fresh widget always starts
> from `main == dev`, whether it came from the CLI (already true) or a
> template copy (may have inherited a stray branch, or a `dev` full of the
> source template's own unrelated preview history). All of this only ever
> applies before your *first* genuine release — once one exists, it's
> permanently a no-op, so it's still safest to never manually re-seed
> `gh-pages` again after that point.

**One-time setup** (the workflow can't do this part for you):

1. **Settings → Pages** → Source: "Deploy from a branch" → branch `gh-pages`
   → `/ (root)`. The workflow creates the `gh-pages` branch itself the first
   time it runs (if it doesn't exist yet), but Pages needs to be pointed at
   it once.
   > ⚠️ **Not `main`.** If Pages is left on (or accidentally set to) `main`,
   > it serves this repo's raw, unbuilt source — including a script tag
   > pointing at `/src/main.tsx` — instead of the built site. The symptom is
   > a blank/black page with a 404 for `/src/main.tsx` in the browser
   > console, even though the workflow itself reports success (it pushed the
   > right build to `gh-pages`; Pages is just reading from the wrong place).
2. **Settings → Actions → General → Workflow permissions** → "Read and write
   permissions". New repos sometimes default the workflow's token to
   read-only, which would fail the push to `gh-pages` with a 403.
3. If the repo is private, set **Pages visibility to Public** — a widget
   embeds inside a Grist iframe, which needs a publicly reachable URL.

No manifest/widget-catalog file is generated — that's a multi-widget,
Grist-widget-repository concept this single-widget template doesn't need.
Paste your `/latest/` or `/v<version>/` URL directly into Grist's custom
widget URL field.

