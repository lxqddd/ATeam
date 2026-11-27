import ProjectServersPanel from './ProjectServersPanel'
import type { ConfigDocumentController, ConfigScope } from '../config-controller'

function ProjectLspPanel({
  controller,
  scope = 'project'
}: {
  controller: ConfigDocumentController
  scope?: ConfigScope
}): React.JSX.Element {
  return <ProjectServersPanel controller={controller} kind="lsp" scope={scope} />
}

export default ProjectLspPanel
