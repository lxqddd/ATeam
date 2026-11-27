import axe from 'axe-core'

// jsdom has no layout or canvas, so axe cannot resolve rendered colours or
// element geometry. Those rules are covered by the visual harness instead.
const DISABLED_RULES: axe.RunOptions['rules'] = {
  'color-contrast': { enabled: false },
  'color-contrast-enhanced': { enabled: false }
}

export interface A11yViolationSummary {
  id: string
  impact: string
  help: string
  targets: string[]
}

/**
 * Runs axe on the rendered document and keeps only serious/critical
 * violations: the blocking issues CI should never let through.
 */
export async function findBlockingA11yViolations(
  context: Element | Document = document.body
): Promise<A11yViolationSummary[]> {
  const results = await axe.run(context, {
    rules: DISABLED_RULES,
    resultTypes: ['violations']
  })

  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      help: violation.help,
      targets: violation.nodes.map((node) => String(node.target))
    }))
}

export function formatA11yViolations(violations: A11yViolationSummary[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.impact}: ${violation.id} — ${violation.help}\n    ${violation.targets.join('\n    ')}`
    )
    .join('\n')
}
