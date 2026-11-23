import type { ToolSet } from 'ai'

export function filterToolsForModel(tools: ToolSet, applyPatch: boolean): ToolSet {
  const filtered = { ...tools }
  if (applyPatch) {
    delete filtered.edit
    delete filtered.write
  } else {
    delete filtered.patch
  }
  return filtered
}
