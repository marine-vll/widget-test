import * as React from "react"
import { Dialog } from "radix-ui"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/** Side panel (form drawer), built on Radix Dialog for focus-trap + Escape-to-close. */
function Sheet(props: React.ComponentProps<typeof Dialog.Root>) {
  return <Dialog.Root data-slot="sheet" {...props} />
}

function SheetContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  title: string
  description?: string
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-foreground/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <Dialog.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col gap-0 border-l border-border bg-background shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <Dialog.Title className="text-sm font-medium text-foreground">
            {title}
          </Dialog.Title>
          <Dialog.Close className="rounded-sm p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <X className="size-4" />
            <span className="sr-only">Fermer</span>
          </Dialog.Close>
        </div>
        {description ? (
          <Dialog.Description className="sr-only">
            {description}
          </Dialog.Description>
        ) : null}
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

export { Sheet, SheetContent }
