import { DeleteOutlined, EditOutlined, FolderOpenOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Empty, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '@ateam/shared'
import type { ProjectsController } from '../projects'

export function ProjectsView({ projects }: { projects: ProjectsController }) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [name, setName] = useState('')

  const startRename = (project: Project) => {
    setRenaming(project)
    setName(project.name)
  }

  return (
    <div className="space-y-4">
      <section className="cd-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="cd-subtitle">{t('projects.title')}</h2>
            <p className="cd-caption mt-1 text-faint">{t('projects.desc')}</p>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void projects.choose()}>
            {t('projects.open')}
          </Button>
        </div>
        {projects.error && <p className="mt-3 text-[12px] text-danger">{projects.error}</p>}
      </section>

      <section className="cd-card p-5">
        {projects.projects.length === 0 ? (
          <Empty description={t('projects.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Button icon={<FolderOpenOutlined />} onClick={() => void projects.choose()}>
              {t('projects.open')}
            </Button>
          </Empty>
        ) : (
          <ul className="space-y-2">
            {projects.projects.map((project) => {
              const active = project.id === projects.activeId
              return (
                <li
                  key={project.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                    active ? 'border-accent/50 bg-accent-soft/40' : 'border-line'
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void projects.select(project.id)}
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpenOutlined className="text-accent" />
                      <span className="cd-label truncate">{project.name}</span>
                      {active && <span className="text-[11px] text-accent-strong">{t('projects.current')}</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-faint">{project.path}</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      aria-label={t('projects.rename')}
                      onClick={() => startRename(project)}
                    />
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t('projects.remove')}
                      onClick={() => void projects.remove(project.id)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Modal
        open={renaming !== null}
        title={t('projects.renameTitle')}
        okText={t('projects.save')}
        cancelText={t('projects.cancel')}
        onCancel={() => setRenaming(null)}
        onOk={() => {
          if (!renaming) return
          void projects.rename(renaming.id, name)
          setRenaming(null)
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} aria-label={t('projects.name')} />
      </Modal>
    </div>
  )
}
