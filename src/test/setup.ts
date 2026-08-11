// jsdom doesn't implement `ResizeObserver`. Radix UI primitives used by the
// widget (Dialog for the side panel, etc.) call it internally, so tests need
// a harmless stub -- the widget never reads sizes back from it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}
