import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Shown at the root of a local `pnpm dev` server, never inside Grist.
// Deliberately a bare shell, not a seeded live preview: an emulator can't
// guarantee parity with real Grist, so the loop worth trusting here is
// `pnpm test` (renderWithGrist, headless) plus the real `dev`-branch loop
// this points at below -- see AGENTS.md's note on why this isn't a fake
// preview instead.
export function LocalDevNotice() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <p className="mb-2 text-center text-sm font-medium text-muted-foreground">
        grist-widget-template · local dev
      </p>
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight">
        Not embedded in Grist
      </h1>
      <p className="mx-auto mt-3 mb-8 max-w-sm text-center text-sm text-muted-foreground">
        This is a local dev server — there's no Grist here to render against.
      </p>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Verify against real Grist</CardTitle>
          <CardDescription>
            Commit and push to <code className="text-foreground">dev</code>,
            then open the printed{" "}
            <code className="text-foreground">/dev/</code> URL in a real
            Grist document — every later push self-reloads inside it within
            seconds. See the README's Deployment section for the full loop.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Not building this widget?</CardTitle>
          <CardDescription>
            <code className="text-foreground">npx grist-widget list</code> to
            see other starting points,{" "}
            <code className="text-foreground">
              npx grist-widget use &lt;example&gt;
            </code>{" "}
            to swap this one out.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
