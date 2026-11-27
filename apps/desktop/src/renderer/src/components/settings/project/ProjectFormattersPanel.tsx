import ProjectServersPanel from './ProjectServersPanel'
import type { ConfigDocumentController, ConfigScope } from '../config-controller'

function ProjectFormattersPanel({
  controller,
  scope = 'project'
}: {
  controller: ConfigDocumentController
  scope?: ConfigScope
}): React.JSX.Element {
  return <ProjectServersPanel controller={controller} kind="formatters" scope={scope} />
}

export default ProjectFormattersPanel
