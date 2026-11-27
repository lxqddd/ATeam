import { describe, expect, it } from 'vitest'
import { makeSession } from '@ateam/agent-core/testing'
import type { ChatMessage, PermissionRequest, QuestionRequest } from '@ateam/shared'
import { createTuiState, type TuiState } from './controller'
import { displayWidth, renderView, truncate, wrapText } from './render'

const NOW = '2026-01-01T00:00:00.000Z'

function state(overrides: Partial<TuiState> = {}): TuiState {
  return {
    ...createTuiState({
      mode: 'local',
      label: 'claude-test',
      workspace: '/work',
      permissionMode: 'ask',
      reasoningEffort: null,
      agent: null,
      rows: 24,
      columns: 80
    }),
    ...overrides
  }
}

function lines(frame: string): string[] {
  return frame.split('\r\n')
}

function message(
  id: string,
  role: ChatMessage['role'],
  parts: ChatMessage['parts'],
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    sessionId: 's1',
    role,
    parts,
    createdAt: NOW,
    updatedAt: NOW,
    status: 'complete',
    ...overrides
  }
}

function permission(): PermissionRequest {
  return {
    id: 'p1',
    sessionId: 's1',
    messageId: 'm1',
    toolCallId: 'c1',
    action: 'shell',
    resource: 'rm -rf build',
    toolName: 'shell',
    createdAt: NOW
  }
}

function question(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: 'q1',
    sessionId: 's1',
    messageId: 'm1',
    toolCallId: 'c1',
    header: '选择方案',
    question: '接下来怎么做？',
    options: [{ label: '继续' }, { label: '停止', description: '结束当前任务' }],
    multiple: true,
    allowCustom: true,
    createdAt: NOW,
    ...overrides
  }
}

describe('displayWidth', () => {
  it('counts ASCII, CJK and emoji by terminal columns', () => {
    expect(displayWidth('abc')).toBe(3)
    expect(displayWidth('你好')).toBe(4)
    expect(displayWidth('a你')).toBe(3)
    expect(displayWidth('🎉')).toBe(2)
    expect(displayWidth('é')).toBe(1)
    expect(displayWidth('​')).toBe(0)
    expect(displayWidth('\x1b[31mred\x1b[0m')).toBe(3)
  })
})

describe('truncate', () => {
  it('keeps short text and cuts wide text on a character boundary', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('你好世界', 5)).toBe('你好…')
    expect(truncate('你好', 1)).toBe('…')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('wrapText', () => {
  it('wraps on spaces and breaks long tokens', () => {
    expect(wrapText('hello world', 6)).toEqual(['hello', 'world'])
    expect(wrapText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
    expect(wrapText('', 4)).toEqual([''])
  })

  it('wraps CJK by width and preserves blank lines', () => {
    expect(wrapText('你好世界', 4)).toEqual(['你好', '世界'])
    expect(wrapText('a\n\nb', 4)).toEqual(['a', '', 'b'])
    expect(wrapText('a\tb', 4)).toEqual(['a  b'])
  })
})

describe('renderView', () => {
  it('draws the full frame without ANSI escapes when color is off', () => {
    const result = renderView(state(), { rows: 24, columns: 80, color: false })
    const rows = lines(result.frame)
    expect(rows).toHaveLength(24)
    for (const row of rows) expect(displayWidth(row)).toBe(80)
    expect(rows[0]).toContain('ATeam TUI · 本地 · claude-test')
    expect(rows[0]).toContain('空闲')
    expect(rows[2]).toContain('会话') // wide layout sidebar header
    expect(rows[22].startsWith('› ')).toBe(true)
    expect(rows[23]).toContain('Enter 发送')
    expect(result.frame).not.toContain('\x1b[')
  })

  it('emits ANSI escapes when color is on', () => {
    const result = renderView(state(), { rows: 24, columns: 80, color: true })
    expect(result.frame).toContain('\x1b[')
    expect(result.frame).toContain('\x1b[1;35m')
  })

  it('shows a resize warning in a tiny terminal', () => {
    const result = renderView(state(), { rows: 7, columns: 40, color: false })
    expect(result.frame).toContain('终端窗口过小')
    expect(result.scrollLimit).toBe(0)
  })

  it('renders the sidebar only on wide terminals', () => {
    const sessions = [makeSession({ id: 's1', title: '重构 TUI', updatedAt: NOW })]
    const wide = renderView(state({ sessions, currentId: 's1', focus: 'sessions' }), {
      rows: 24,
      columns: 100,
      color: false
    })
    expect(wide.frame).toContain('会话')
    expect(wide.frame).toContain('▸')
    expect(wide.frame).toContain('重构 TUI')

    const narrow = renderView(state({ sessions, currentId: 's1' }), {
      rows: 24,
      columns: 70,
      color: false
    })
    expect(narrow.frame).not.toContain('重构 TUI')
    for (const row of lines(narrow.frame)) expect(displayWidth(row)).toBe(70)
  })

  it('renders streaming text, reasoning and tool cards', () => {
    const messages: ChatMessage[] = [
      message('u1', 'user', [{ type: 'text', text: '你好世界' }]),
      message(
        'a1',
        'assistant',
        [
          { type: 'reasoning', text: '先想一想' },
          { type: 'text', text: '正在处理' },
          {
            type: 'tool',
            toolCallId: 'c1',
            toolName: 'shell',
            input: { command: 'ls' },
            state: 'completed',
            output: 'a.txt\nb.txt'
          }
        ],
        { status: 'streaming' }
      )
    ]
    const result = renderView(state({ messages, currentId: 's1' }), {
      rows: 24,
      columns: 80,
      color: false
    })
    expect(result.frame).toContain('› 你好世界')
    expect(result.frame).toContain('⋯ 先想一想')
    expect(result.frame).toContain('正在处理')
    expect(result.frame).toContain('b.txt▌')
    expect(result.frame).toContain('⚙ shell · 完成')
    expect(result.frame).toContain('a.txt')
  })

  it('renders empty, failed and interrupted states', () => {
    const empty = renderView(state(), { rows: 24, columns: 80, color: false })
    expect(empty.frame).toContain('暂无消息。')

    const failed = renderView(
      state({
        messages: [
          message('a1', 'assistant', [{ type: 'text', text: 'oops' }], {
            status: 'error',
            error: 'boom'
          })
        ]
      }),
      { rows: 24, columns: 80, color: false }
    )
    expect(failed.frame).toContain('✗ 错误：boom')

    const interrupted = renderView(
      state({
        messages: [
          message('a1', 'assistant', [{ type: 'text', text: 'done' }], {
            status: 'interrupted'
          })
        ]
      }),
      { rows: 24, columns: 80, color: false }
    )
    expect(interrupted.frame).toContain('■ 已中断')
  })

  it('renders the permission overlay with the selected choice', () => {
    const result = renderView(
      state({
        currentId: 's1',
        overlay: 'permission',
        permissionIndex: 2,
        permissions: [permission()]
      }),
      { rows: 24, columns: 80, color: false }
    )
    expect(result.frame).toContain('权限确认')
    expect(result.frame).toContain('工具：shell')
    expect(result.frame).toContain('允许一次')
    expect(result.frame).toContain('始终允许')
    expect(result.frame).toContain('▸ 拒绝')
    expect(lines(result.frame)[23]).toContain('y 允许一次')
  })

  it('renders the question overlay, custom answer and help', () => {
    const overlay = renderView(
      state({
        currentId: 's1',
        overlay: 'question',
        questionSelected: [0],
        questions: [question()]
      }),
      { rows: 24, columns: 80, color: false }
    )
    expect(overlay.frame).toContain('选择答案')
    expect(overlay.frame).toContain('[x] 继续')
    expect(overlay.frame).toContain('[ ] 停止')
    expect(overlay.frame).toContain('结束当前任务')
    expect(overlay.frame).toContain('按 e 输入自定义答案')

    const custom = renderView(
      state({
        currentId: 's1',
        overlay: 'question',
        questionCustom: '换个思路',
        questions: [question()]
      }),
      { rows: 24, columns: 80, color: false }
    )
    expect(custom.frame).toContain('自定义答案：换个思路▌')

    const help = renderView(state({ overlay: 'help' }), {
      rows: 24,
      columns: 80,
      color: false
    })
    expect(help.frame).toContain('快捷键')
    expect(help.frame).toContain('Ctrl-T')
  })

  it('reports the scroll limit and shows older lines when scrolled up', () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      message(`u${index}`, 'user', [{ type: 'text', text: `m${index}` }])
    )
    const bottom = renderView(state({ messages }), { rows: 10, columns: 80, color: false })
    expect(bottom.scrollLimit).toBeGreaterThan(0)
    expect(bottom.frame).toContain('m5')

    const top = renderView(state({ messages, scroll: bottom.scrollLimit }), {
      rows: 10,
      columns: 80,
      color: false
    })
    expect(top.frame).toContain('m0')
    expect(top.frame).not.toContain('m5')
  })

  it('shows queued messages and errors in the header and footer', () => {
    const result = renderView(
      state({ currentId: 's1', running: true, queued: 2, error: '连接失败' }),
      { rows: 24, columns: 80, color: false }
    )
    expect(result.frame).toContain('队列 2')
    expect(result.frame).toContain('运行中')
    expect(result.frame).toContain('✗ 连接失败')
  })
})
