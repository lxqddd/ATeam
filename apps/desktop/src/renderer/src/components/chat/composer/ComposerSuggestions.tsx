import { useTranslation } from 'react-i18next'
import type { CommandDefinition } from '@ateam/shared'
import type { MentionState } from './useMentionSearch'

interface ComposerSuggestionsProps {
  commandItems: CommandDefinition[]
  activeCommand: number
  onApplyCommand: (command: CommandDefinition) => void
  mention: MentionState | null
  activeMention: number
  onApplyMention: (filePath: string) => void
}

function ComposerSuggestions({
  commandItems,
  activeCommand,
  onApplyCommand,
  mention,
  activeMention,
  onApplyMention
}: ComposerSuggestionsProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      {commandItems.length > 0 && (
        <div
          role="listbox"
          aria-label={t('chat.commands')}
          className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-1"
        >
          {commandItems.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={index === Math.min(activeCommand, commandItems.length - 1)}
              onClick={() => onApplyCommand(command)}
              className={`block w-full rounded px-2 py-1 text-left transition-colors hover:bg-hover ${
                index === Math.min(activeCommand, commandItems.length - 1) ? 'bg-hover' : ''
              }`}
            >
              <span className="block truncate text-label text-foreground">
                <span aria-hidden className="text-muted">
                  /
                </span>
                {command.name}
                <span className="ml-1.5 inline-flex h-[18px] items-center rounded-full border border-border bg-surface px-1.5 align-middle text-[12px] leading-none font-medium text-muted">
                  {t(`chat.commandSource.${command.source}`)}
                </span>
              </span>
              {command.description && (
                <span className="mt-0.5 block truncate text-caption text-muted">
                  {command.description}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {mention && (
        <div
          role="listbox"
          aria-label={t('chat.mentionFiles')}
          className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-1"
        >
          {mention.items.map((filePath, index) => (
            <button
              key={filePath}
              type="button"
              role="option"
              aria-selected={index === Math.min(activeMention, mention.items.length - 1)}
              onClick={() => onApplyMention(filePath)}
              className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-caption text-foreground transition-colors hover:bg-hover ${
                index === Math.min(activeMention, mention.items.length - 1) ? 'bg-hover' : ''
              }`}
            >
              {filePath}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export default ComposerSuggestions
