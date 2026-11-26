import type { FileDiffHunk } from '@ateam/shared'
import { lineClass } from './diff-style'

/** Renders unified diff hunks for the session and working-tree views. */
export function DiffHunks({ hunks }: { hunks: FileDiffHunk[] }): React.JSX.Element {
  return (
    <>
      {hunks.map((hunk, hunkIndex) => (
        <div key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          <div className="sticky top-0 bg-background-subtle px-3 py-1 font-mono text-[11px] text-accent-strong">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </div>
          <pre className="m-0 overflow-x-auto px-0 py-0 font-mono text-[12px] leading-[1.6]">
            {hunk.lines.map((line, lineIndex) => (
              <div key={lineIndex} className={`whitespace-pre px-3 ${lineClass(line)}`}>
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </>
  )
}
