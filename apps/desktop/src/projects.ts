import { app, dialog, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Project, ProjectList } from '@ateam/shared' with { "resolution-mode": "import" }

interface StoredProjects extends ProjectList {}

const file = () => path.join(app.getPath('userData'), 'projects.json')

function read(): StoredProjects {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return { projects: [] }
    const value = parsed as StoredProjects
    return { projects: Array.isArray(value.projects) ? value.projects : [], activeId: value.activeId }
  } catch {
    return { projects: [] }
  }
}

function write(value: StoredProjects) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function validate(directory: string) {
  let stat: fs.Stats
  try {
    stat = fs.statSync(directory)
  } catch {
    throw new Error(`目录不存在：${directory}`)
  }
  if (!stat.isDirectory()) throw new Error(`不是目录：${directory}`)
  try {
    fs.accessSync(directory, fs.constants.R_OK)
  } catch {
    throw new Error(`没有读取权限：${directory}`)
  }
}

export function listProjects(): ProjectList {
  const value = read()
  return {
    projects: value.projects.toSorted((left, right) =>
      (right.lastOpenedAt ?? '').localeCompare(left.lastOpenedAt ?? ''),
    ),
    ...(value.activeId ? { activeId: value.activeId } : {}),
  }
}

export function activeProject(): Project | undefined {
  const value = read()
  return value.projects.find((project) => project.id === value.activeId)
}

/** The directory new sessions run in; the managed workspace stands in when no project is open. */
export function activeDirectory(fallback: string): string {
  const project = activeProject()
  if (!project) return fallback
  try {
    validate(project.path)
    return project.path
  } catch {
    return fallback
  }
}

export async function chooseProject(window: BrowserWindow | null): Promise<Project | null> {
  const options = {
    title: '选择项目目录',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  const selected = result.filePaths[0]
  if (result.canceled || !selected) return null
  const resolved = path.resolve(selected)
  validate(resolved)
  return addProject(resolved)
}

export function addProject(directory: string): Project {
  validate(directory)
  const value = read()
  const existing = value.projects.find((project) => project.path === directory)
  const project: Project = {
    id: existing?.id ?? randomUUID(),
    name: existing?.name ?? (path.basename(directory) || directory),
    path: directory,
    lastOpenedAt: new Date().toISOString(),
  }
  value.projects = [project, ...value.projects.filter((item) => item.id !== project.id)]
  value.activeId = project.id
  write(value)
  return project
}

export function selectProject(id: string): ProjectList {
  const value = read()
  if (!value.projects.some((project) => project.id === id)) throw new Error('项目不存在')
  value.activeId = id
  value.projects = value.projects.map((project) =>
    project.id === id ? { ...project, lastOpenedAt: new Date().toISOString() } : project,
  )
  write(value)
  return listProjects()
}

export function removeProject(id: string): ProjectList {
  const value = read()
  value.projects = value.projects.filter((project) => project.id !== id)
  if (value.activeId === id) delete value.activeId
  write(value)
  return listProjects()
}

export function renameProject(id: string, name: string): ProjectList {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('项目名称不能为空')
  const value = read()
  if (!value.projects.some((project) => project.id === id)) throw new Error('项目不存在')
  value.projects = value.projects.map((project) =>
    project.id === id ? { ...project, name: trimmed } : project,
  )
  write(value)
  return listProjects()
}
