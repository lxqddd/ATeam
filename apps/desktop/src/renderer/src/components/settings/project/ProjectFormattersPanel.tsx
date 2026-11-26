import ProjectServersPanel from './ProjectServersPanel'
import type { ProjectConfigController } from './useProjectConfig'

function ProjectFormattersPanel({
  controller
}: {
  controller: ProjectConfigController
}): React.JSX.Element {
  return <ProjectServersPanel controller={controller} kind="formatters" />
}

export default ProjectFormattersPanel
