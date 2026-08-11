#!/usr/bin/env node
// Deploy publisher for GitHub Pages (gh-pages branch), single-widget repo.
//
// Adapted from the grist-widget-sdk monorepo's scripts/deploy/publish.mjs —
// same two channels, minus the multi-widget folder loop and manifest.json
// (there's only one widget here, so nothing to catalog):
//
//   release (push to main / workflow_dispatch)
//     - immutable  /<repo>/v<version>/   (built once, never overwritten)
//     - mutable    /<repo>/latest/       (alias to newest release)
//     - /<repo>/versions.json            (released-version index, newest first
//                                        -- read by the showcase hub/notice)
//
//   dev (push to dev)
//     - mutable    /<repo>/dev/          (+ version.json + self-reload)
//
// Design notes: dependency-free (node builtins only). Pure helpers are
// exported for testing; the CLI is a thin dispatch at the bottom.
//
// Subcommands:
//   plan     --site <dir> --repo <name> --event <push|workflow_dispatch>
//            --ref <ref> [--force]
//     Prints JSON { context: "release"|"dev", version?, base, skip }.
//     Release is skipped when v<version> already exists on gh-pages
//     (idempotence: re-pushing main without a version bump is a no-op).
//     A repo's first genuine release always resolves to v0.0.1 regardless of
//     package.json's version -- so "Use this template" (whose initial push
//     to main fires this workflow) publishes a clean v0.0.1 straight away.
//
//   place    --site <dir> --repo <name> --channel <release|dev>
//            [--version <v>] --dist <dir> --sha <sha> [--ref <ref>]
//     Copies a freshly built dist into the gh-pages tree.
//
//   remove   --site <dir>
//     Removes dev/ from the gh-pages tree (retire the dev URL when the `dev`
//     branch is deleted). Never touches a release or latest/.
//
//   finalize --site <dir> [--update-versions] [--push] [--commit-message <msg>]
//     Regenerates versions.json (release runs only) and commits + pushes the
//     gh-pages tree with a rebase-and-retry loop.
//
//   reset-branches [--repo-dir <dir>] [--repo <name>]
//     On a repo's first genuine release only (caller gates on plan()'s
//     firstRelease): renames the four placeholder-identity spots (only if
//     --repo is given and they still carry the template's own placeholder
//     text -- a no-op for a CLI scaffold that already renamed itself), resets
//     package.json's version to 0.0.1, prunes every branch except
//     main/dev/gh-pages, and force-resets dev to main's current tip.

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  cpSync,
} from "node:fs"
import { join, dirname } from "node:path"
import { execFileSync } from "node:child_process"

// ----------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ----------------------------------------------------------------------------

/** Absolute Pages base path for a channel, e.g. "/my-widget/v1.2.0/". */
export function basePathFor(repo, channel, version) {
  const leaf = channel === "dev" ? "dev" : `v${version}`
  return `/${repo}/${leaf}/`
}

/**
 * Was `versionDir` actually published by *this* repo's own pipeline? Checks
 * for a `showcase-meta.json` whose `repo` field matches -- not just that the
 * directory exists. A `gh-pages` branch manually seeded from another repo's
 * export (found live: a freshly-created widget repo's `gh-pages` already
 * contained `v<version>/` directories copied from the template repo it came
 * from, some with no meta file at all, one with a foreign `showcase-meta.json`
 * whose `sha` didn't belong to this repo's own history) would otherwise look
 * indistinguishable from a real prior release and get silently treated as
 * "already published" forever, permanently squatting on that version path.
 */
function isGenuineRelease(versionDir, repo) {
  const metaPath = join(versionDir, "showcase-meta.json")
  if (!existsSync(metaPath)) return false
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8"))
    return meta.repo === repo
  } catch {
    return false
  }
}

/**
 * Whether this repo has ever genuinely published a release (a v<version>/
 * dir whose showcase-meta.json names this repo). Shared by `plan()` (forces
 * the first release to 0.0.1) and `cleanupForeignVersionsIfFirstRelease()`
 * (clears inherited v<version>/ noise) -- both need the exact same signal.
 */
function hasGenuineRelease(siteDir, repo) {
  return buildVersionsManifest(siteDir, repo).length > 0
}

/**
 * Build the release/dev plan from this repo's own package.json + the current
 * gh-pages tree. Release is skipped when its immutable v<version> dir was
 * genuinely published by this repo before (unless force), so re-pushing main
 * without a version bump is a no-op.
 */
export function plan(siteDir, repo, event, ref, { force = false } = {}) {
  const isRelease = event === "workflow_dispatch" || ref === "refs/heads/main" || ref === "main"
  if (!isRelease) {
    return { context: "dev", base: basePathFor(repo, "dev") }
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  // A repo's first genuine release always starts at 0.0.1, regardless of
  // whatever package.json's version field says -- found live: a repo copied
  // via GitHub's "Use this template" inherited "0.2.18" from the source
  // template repo's own main branch (itself a canary-stamped scaffold that
  // had been promoted there), instead of starting fresh. This is what makes
  // "Use this template" publish a clean v0.0.1 the moment the repo is
  // created (GitHub's own initial push to main fires this workflow): the
  // copy's inherited canary version is ignored for that first release. To
  // keep the *next* release clean too, the workflow's first-release reset
  // step rewrites package.json's version back to 0.0.1 in the repo itself
  // (see `resetBranchesIfFirstRelease`), so the second release naturally
  // bumps from 0.0.1 rather than the inherited canary number. Once a repo
  // has a genuine release, this override no longer applies -- its own
  // version bumps are its own responsibility from then on.
  const firstRelease = !hasGenuineRelease(siteDir, repo)
  const version = firstRelease ? "0.0.1" : pkg.version
  if (!version) throw new Error("package.json has no version")
  const versionDir = join(siteDir, `v${version}`)
  const exists = isGenuineRelease(versionDir, repo)
  const skip = exists && !force
  // T-07: "merging without bumping the version publishes nothing" was a
  // silent no-op, documented in two places (this file's own header comment,
  // and AGENTS.md's Anti-patterns) instead of made unrepresentable. Turn it
  // loud for the one case that actually means "I meant to publish and
  // didn't": a genuine `push` to main (not `workflow_dispatch`, which has
  // its own explicit --force for intentional rebuilds) landed on a repo
  // that's already released before, and the version it resolved to was
  // already published. If HEAD's parent had the *same* version, nothing
  // about this push looks like an intentional re-run -- fail the workflow
  // step instead of quietly reporting success. Falls back to today's silent
  // skip if HEAD~1 doesn't resolve (e.g. a squashed/rebased history, or
  // this being the repo's very first commit) -- this is a backstop for the
  // common case, not a guarantee for every git topology.
  if (event === "push" && !firstRelease && skip) {
    try {
      const previousPkgJson = execFileSync("git", ["show", "HEAD~1:package.json"], {
        encoding: "utf8",
      })
      const previousVersion = JSON.parse(previousPkgJson).version
      if (previousVersion === version) {
        throw new Error(
          `deploy: this push to main would publish nothing -- v${version} was already released and ` +
            `package.json's version is unchanged from the previous commit. Bump "version" in package.json ` +
            `before merging if you meant to publish new content (see AGENTS.md's Anti-patterns).`
        )
      }
    } catch (err) {
      // Re-throw our own message; swallow only git/JSON failures (HEAD~1
      // missing, package.json didn't exist at that commit, etc.) and fall
      // through to the existing silent-skip behavior for those cases.
      if (err instanceof Error && err.message.startsWith("deploy: this push")) throw err
    }
  }
  return {
    context: "release",
    version,
    base: basePathFor(repo, "release", version),
    skip,
    reason: exists ? (force ? "force-rebuild" : "already-published") : "new-version",
    // Exposed so the workflow can gate a one-time repo cleanup (prune stray
    // branches, reset dev to main) on exactly this signal -- see
    // `resetBranchesIfFirstRelease`.
    firstRelease,
  }
}

/** The dev-only self-reload snippet, embedding this build's short SHA. */
export function selfReloadSnippet(sha) {
  return `<script>
/* grist-widget-sdk dev channel: auto-reload when a newer build is published. */
(function () {
  var CURRENT = ${JSON.stringify(sha)};
  var POLL_MS = 5000;
  async function check() {
    try {
      var res = await fetch("version.json?ts=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return;
      var data = await res.json();
      if (data && data.sha && data.sha !== CURRENT) {
        var url = new URL(location.href);
        url.searchParams.set("__dev", data.sha); // unique => busts Pages CDN + browser cache
        location.replace(url.toString());        // preserves Grist's own iframe query params
      }
    } catch (e) { /* transient offline / 404 during publish: keep polling */ }
  }
  check(); // don't wait a full POLL_MS for the first check -- a plain
           // (non-cache-busted) request for this very page can hit a stale
           // CDN-cached index.html referencing JS assets a newer deploy
           // already deleted, producing a blank/black screen until this
           // fires; found live, waiting the full interval left that
           // black screen up for ~5s on a fresh visit.
  setInterval(check, POLL_MS);
})();
</script>`
}

/** Insert the snippet just before </body> (or append if none). Idempotent-ish: strips a prior block first. */
export function injectSelfReload(html, sha) {
  const marker = "grist-widget-sdk dev channel"
  let out = html
  if (out.includes(marker)) {
    out = out.replace(/<script>\s*\/\* grist-widget-sdk dev channel[\s\S]*?<\/script>\s*/g, "")
  }
  const snippet = selfReloadSnippet(sha) + "\n"
  if (out.includes("</body>")) return out.replace("</body>", snippet + "</body>")
  return out + snippet
}

/**
 * Scan siteDir for previously-released v<version>/showcase-meta.json files
 * and assemble the versions.json manifest, newest first. Read by the
 * showcase hub (TemplateLanding) and per-channel notice (ChannelNotice) to
 * show this widget's own release history -- not the grist-widget-sdk
 * monorepo's (found live: every scaffolded widget's version index showed
 * the monorepo's versions instead of its own, since showcase-versions.ts
 * used to hardcode that URL). Entries whose meta has no `repo` field, or a
 * `repo` that doesn't match this repo, are skipped -- a `gh-pages` branch
 * manually seeded from another repo's export (found live) would otherwise
 * leak that repo's own version history into this one's index.
 */
export function buildVersionsManifest(siteDir, repo) {
  const entries = []
  for (const name of existsSync(siteDir) ? readdirSync(siteDir) : []) {
    if (!/^v\d+\.\d+\.\d+/.test(name)) continue
    const metaPath = join(siteDir, name, "showcase-meta.json")
    if (!existsSync(metaPath)) continue
    const meta = JSON.parse(readFileSync(metaPath, "utf8"))
    if (meta.repo !== repo) continue
    entries.push({ version: meta.version, publishedAt: meta.publishedAt })
  }
  entries.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  return entries
}

// ----------------------------------------------------------------------------
// Filesystem / git effects
// ----------------------------------------------------------------------------

function replaceDir(dest, srcDist) {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(srcDist, dest, { recursive: true })
}

/**
 * If this repo has never genuinely published a release before (no
 * v<version>/ directory whose showcase-meta.json matches this repo), *every*
 * top-level entry except `dev/` (the mutable dev channel, legitimately this
 * repo's own regardless of release history) and a small set of
 * pipeline-managed files is provably inherited noise -- e.g. from copying
 * this template repo including its gh-pages branch (GitHub's "Use this
 * template" -> "Include all branches"): stray `v<version>/` directories,
 * but also a root `index.html`/`latest/` still referencing the *source*
 * repo's own base path (found live: a fresh copy's root and `latest/`
 * pointed at `/grist-widget-template/v0.2.22/assets/...`, which 404s on
 * this repo's own Pages site). Called by `placeTarget` right before it
 * writes this repo's own first release, so the inherited noise is replaced
 * rather than layered under. Safe to clear unconditionally: a repo with
 * zero genuine releases can't have any of its own history to lose. Once a
 * genuine release exists for this repo, buildVersionsManifest is non-empty
 * and this is permanently a no-op.
 */
export function cleanupForeignVersionsIfFirstRelease(siteDir, repo) {
  if (hasGenuineRelease(siteDir, repo)) return { cleaned: [] }
  const PROTECTED = new Set([".nojekyll", "dev", "versions.json", ".git"])
  const cleaned = []
  for (const name of existsSync(siteDir) ? readdirSync(siteDir) : []) {
    if (PROTECTED.has(name)) continue
    rmSync(join(siteDir, name), { recursive: true, force: true })
    cleaned.push(name)
  }
  return { cleaned }
}

/** Place a freshly built dist into the gh-pages tree. */
export function placeTarget({ siteDir, channel, version, distDir, sha, ref, repo }) {
  if (!existsSync(distDir)) throw new Error(`dist not found: ${distDir}`)
  if (channel === "dev") {
    const devDir = join(siteDir, "dev")
    replaceDir(devDir, distDir)
    writeFileSync(
      join(devDir, "version.json"),
      JSON.stringify({ sha, builtAt: new Date().toISOString(), ref: ref || null }, null, 2) + "\n",
    )
    const indexPath = join(devDir, "index.html")
    if (existsSync(indexPath)) {
      writeFileSync(indexPath, injectSelfReload(readFileSync(indexPath, "utf8"), sha))
    }
    return { placed: "dev" }
  }
  // release: immutable v<version>/, mutable latest/, and the same build
  // placed directly at the site root too. main.tsx renders the showcase hub
  // (TemplateLanding) at any URL with no recognized channel suffix — the
  // bare root included — so without this, a real scaffolded repo's own
  // https://owner.github.io/repo/ has nothing deployed there at all and
  // 404s instead of ever reaching that hub. Reusing the release dist here is
  // exactly like latest/ reusing it: the asset URLs it references (under
  // v<version>/assets/) already exist from the versionDir placement above,
  // so nothing 404s.
  cleanupForeignVersionsIfFirstRelease(siteDir, repo)
  const versionDir = join(siteDir, `v${version}`)
  replaceDir(versionDir, distDir)
  writeFileSync(
    join(versionDir, "showcase-meta.json"),
    JSON.stringify({ version, publishedAt: new Date().toISOString(), sha, repo }, null, 2) + "\n",
  )
  const latestDir = join(siteDir, "latest")
  replaceDir(latestDir, distDir)
  mkdirSync(siteDir, { recursive: true })
  cpSync(distDir, siteDir, { recursive: true })
  return { placed: `v${version}`, latest: "latest", root: true }
}

/**
 * Remove the mutable dev dir from the gh-pages tree (retire the dev URL when
 * the `dev` branch is deleted). Only ever touches `dev/` — never a versioned
 * release or `latest/`. No-op if absent.
 */
export function removeDevDir(siteDir) {
  const devDir = join(siteDir, "dev")
  if (!existsSync(devDir)) return { removed: false }
  rmSync(devDir, { recursive: true, force: true })
  return { removed: true, path: "dev" }
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim()
}

function sleep(ms) {
  // synchronous backoff (deploy step is not latency-sensitive)
  const end = Date.now() + ms
  while (Date.now() < end) {}
}

/** Regenerate versions.json (release runs only), then commit + push with rebase-retry. */
export function finalize({ siteDir, updateVersions, push, commitMessage, remoteBranch = "gh-pages", repo }) {
  if (updateVersions) {
    const versions = buildVersionsManifest(siteDir, repo)
    writeFileSync(join(siteDir, "versions.json"), JSON.stringify(versions, null, 2) + "\n")
  }
  git(["add", "-A"], siteDir)
  const status = git(["status", "--porcelain"], siteDir)
  if (!status) {
    console.log("deploy: nothing to commit (no-op)")
    return { committed: false }
  }
  git(["commit", "-m", commitMessage || "deploy: publish widget"], siteDir)
  if (!push) return { committed: true, pushed: false }

  let lastErr
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      git(["push", "origin", `HEAD:${remoteBranch}`], siteDir)
      return { committed: true, pushed: true, attempts: attempt }
    } catch (err) {
      lastErr = err
      console.warn(`deploy: push attempt ${attempt} failed, rebasing on origin/${remoteBranch}`)
      try {
        git(["fetch", "origin", remoteBranch], siteDir)
        git(["rebase", `origin/${remoteBranch}`], siteDir)
      } catch (rebaseErr) {
        git(["rebase", "--abort"], siteDir)
        throw rebaseErr
      }
      if (attempt < 4) sleep(2000 * 2 ** (attempt - 1)) // 2s,4s,8s
    }
  }
  throw lastErr
}

/**
 * Derive an npm-safe package name and a human title from a real GitHub repo
 * name -- which allows characters (uppercase, underscores, periods) npm
 * package names don't. Mirrors the title-casing
 * `packages/create-grist-widget/bin/create-grist-widget.mjs` already applies
 * to its own CLI-provided `rawName`, so a repo named e.g. `Ask-Genial_Widget`
 * produces the same shape of package name / title a CLI user typing
 * `ask-genial-widget` would have gotten.
 */
export function deriveIdentity(repoName) {
  const packageName =
    (repoName || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "grist-widget"
  const title = packageName
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
  return { packageName, title }
}

/**
 * The same four placeholder-identity edits
 * `packages/create-grist-widget/bin/create-grist-widget.mjs` applies at
 * scaffold time, parameterized by a derived identity instead of CLI input.
 * Each substitution is a plain string replace, so it's naturally a no-op
 * wherever the placeholder text is already gone -- a CLI-scaffolded repo
 * (whose name may legitimately differ from its GitHub repo name) is never
 * touched by this.
 */
function identityEdits({ packageName, title }) {
  return [
    ["package.json", [["grist-widget-template-vite", packageName]]],
    ["README.md", [["grist-widget-template-vite", packageName]]],
    ["index.html", [["<title>Grist Widget</title>", `<title>${title}</title>`]]],
    ["src/App.tsx", [['title: "Grist Widget Template",', `title: "${title}",`]]],
  ]
}

/**
 * Establish the state every widget repo should start from, on its first
 * genuine release only (gated by the caller on `plan()`'s `firstRelease`):
 *
 *   0. If `repo` is given, rewrite the four placeholder-identity spots (see
 *      `identityEdits`) to match the real repo name -- the piece "Use this
 *      template" skips entirely, since it copies the repo verbatim and never
 *      runs the CLI's own rename step. Folded into the same commit as the
 *      version reset below, not a separate one.
 *   1. Reset package.json's version to 0.0.1. The first release already
 *      published v0.0.1 (forced by plan() regardless of package.json), but a
 *      repo copied via GitHub's "Use this template" still carries the source
 *      template's inherited canary version in the file (found live: a copy
 *      shipped 0.2.23) -- so its *next* release would jump straight to
 *      v0.2.24 instead of a clean v0.0.2. Rewriting the file to 0.0.1 here,
 *      committed to main, makes the next bump land on 0.0.2. A CLI scaffold
 *      already ships 0.0.1, so this is a no-op there.
 *   2. main == dev, gh-pages CI-managed only: prune every other branch and
 *      force-reset `dev` to `main`'s current tip (which now carries the
 *      version-reset commit). A CLI scaffold satisfies this trivially; a
 *      "Use this template" copy may have a stray inherited branch, or a
 *      `dev` tracking the source template's own unrelated preview history.
 *
 * Operates on `repoDir`, the repo's own checkout -- a different directory
 * than the gh-pages `siteDir` every other function here works with. The
 * version-reset commit re-triggers this workflow on main, but that run sees
 * a genuine release already published (firstRelease=false) and skips both
 * the release and this reset, so there's no loop.
 */
export function resetBranchesIfFirstRelease(repoDir, repo, keep = ["main", "dev", "gh-pages"]) {
  const changedFiles = new Set()
  const renamedFiles = []

  if (repo) {
    for (const [file, subs] of identityEdits(deriveIdentity(repo))) {
      const p = join(repoDir, file)
      if (!existsSync(p)) continue
      const before = readFileSync(p, "utf8")
      const after = subs.reduce((text, [search, replace]) => text.split(search).join(replace), before)
      if (after !== before) {
        writeFileSync(p, after)
        changedFiles.add(file)
        renamedFiles.push(file)
      }
    }
  }
  const identityReset = renamedFiles.length > 0

  let versionReset = false
  const pkgPath = join(repoDir, "package.json")
  if (existsSync(pkgPath)) {
    // Re-read after any identity edit above, so a rewritten `name` survives
    // this JSON round-trip instead of being clobbered by it.
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    if (pkg.version !== "0.0.1") {
      pkg.version = "0.0.1"
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
      changedFiles.add("package.json")
      versionReset = true
    }
  }

  if (changedFiles.size > 0) {
    const parts = []
    if (identityReset) parts.push("personalize scaffold")
    if (versionReset) parts.push("reset version to 0.0.1")
    git(["add", ...changedFiles], repoDir)
    git(
      [
        "-c", "user.name=github-actions[bot]",
        "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit", "-m", `chore: ${parts.join(" + ")} for a clean first release`,
      ],
      repoDir,
    )
    git(["push", "origin", "HEAD:refs/heads/main"], repoDir)
  }

  const raw = git(["ls-remote", "--heads", "origin"], repoDir)
  const branches = raw
    ? raw.split("\n").map((line) => line.split("refs/heads/")[1]).filter(Boolean)
    : []
  const deletedBranches = []
  for (const b of branches) {
    if (keep.includes(b)) continue
    git(["push", "origin", "--delete", b], repoDir)
    deletedBranches.push(b)
  }
  git(["push", "--force", "origin", "HEAD:refs/heads/dev"], repoDir)
  return { deletedBranches, devReset: true, versionReset, identityReset, renamedFiles }
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) out[key] = true
      else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)

  switch (cmd) {
    case "plan": {
      const result = plan(args.site, args.repo, args.event, args.ref, {
        force: !!args.force,
      })
      process.stdout.write(JSON.stringify(result))
      break
    }
    case "place": {
      const res = placeTarget({
        siteDir: args.site,
        channel: args.channel,
        version: args.version,
        distDir: args.dist,
        sha: args.sha,
        ref: args.ref,
        repo: args.repo,
      })
      console.log("placed:", JSON.stringify(res))
      break
    }
    case "remove": {
      const res = removeDevDir(args.site)
      console.log("remove:", JSON.stringify(res))
      break
    }
    case "finalize": {
      const res = finalize({
        siteDir: args.site,
        updateVersions: !!args["update-versions"],
        push: !!args.push,
        commitMessage: args["commit-message"],
        repo: args.repo,
      })
      console.log("finalize:", JSON.stringify(res))
      break
    }
    case "reset-branches": {
      const res = resetBranchesIfFirstRelease(args["repo-dir"] || ".", args.repo)
      console.log("reset-branches:", JSON.stringify(res))
      break
    }
    default:
      console.error(`unknown subcommand: ${cmd || "(none)"}`)
      process.exit(2)
  }
}

// Only run the CLI when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) main()
