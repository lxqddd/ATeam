// Browser stand-in for the small slice of Vitest used by the renderer API mock,
// so the visual harness can reuse the same fixtures as the unit tests.
type Implementation = (...args: unknown[]) => unknown

export const vi = {
  fn(implementation?: Implementation): Implementation {
    return (...args: unknown[]) => implementation?.(...args)
  }
}
