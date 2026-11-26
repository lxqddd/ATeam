import ProjectServersPanel from './ProjectServersPanel'
import type { ProjectConfigController } from './useProjectConfig'

function ProjectLspPanel({
  controller
}: {
  controller: ProjectConfigController
}): React.JSX.Element {
  return <ProjectServersPanel controller={controller} kind="lsp" />
}

export default ProjectLspPanel
