import { useCallback, useEffect, useState } from 'react'
import type { Project, ProjectList } from '@ateam/shared'

const bridge = () => window.ateam?.projects

export interface ProjectsController {
  projects: Project[]
  activeId?: string
  activeProject: Project | null
  error: string
  choose: () => Promise<void>
  select: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useProjects(): ProjectsController {
  const [list, setList] = useState<ProjectList>({ projects: [] })
  const [error, setError] = useState('')

  const apply = useCallback((next: ProjectList | null | undefined) => {
    if (next) setList(next)
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await bridge()?.list())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [apply])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const choose = useCallback(async () => {
    try {
      const project = await bridge()?.choose()
      if (project) apply(await bridge()?.list())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [apply])

  const select = useCallback(
    async (id: string) => {
      try {
        apply(await bridge()?.select(id))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [apply],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        apply(await bridge()?.remove(id))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [apply],
  )

  const rename = useCallback(
    async (id: string, name: string) => {
      try {
        apply(await bridge()?.rename(id, name))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [apply],
  )

  return {
    projects: list.projects,
    ...(list.activeId ? { activeId: list.activeId } : {}),
    activeProject: list.projects.find((project) => project.id === list.activeId) ?? null,
    error,
    choose,
    select,
    remove,
    rename,
    refresh,
  }
}
