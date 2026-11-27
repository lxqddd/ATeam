import type { ChatMessage, MessagePart, SessionMeta, ToolState } from '@ateam/shared'
import { PERMISSION_CHOICES, type TuiState } from './controller'

export interface RenderOptions {
  rows: number
  columns: number
  color: boolean
}

export interface RenderResult {
  frame: string
  /** Maximum useful value for `state.scroll`. */
  scrollLimit: number
}

type Style =
  | 'default'
  | 'dim'
  | 'accent'
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'success'
  | 'warning'
  | 'error'
  | 'header'
  | 'reverse'

interface Line {
  text: string
  style: Style
}

interface Segment {
  text: string
  style: Style
}

const ANSI: Record<Exclude<Style, 'default'>, string> = {
  dim: '\x1b[2m',
  accent: '\x1b[36m',
  user: '\x1b[1;36m',
  assistant: '',
  reasoning: '\x1b[2;3m',
  tool: '\x1b[33m',
  success: '\x1b[32m',
  warning: '\x1b[33m',
  error: '\x1b[1;31m',
  header: '\x1b[1;35m',
  reverse: '\x1b[7m'
}

// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd]
]

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code === 0) return 0
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0
  if (code >= 0x300 && code <= 0x36f) return 0
  if (code === 0x200b || code === 0x200c || code === 0x200d) return 0
  for (const [start, end] of WIDE_RANGES) {
    if (code >= start && code <= end) return 2
  }
  return 1
}

/** Terminal columns a string occupies, ignoring ANSI escapes. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text.replace(ANSI_PATTERN, '')) width += charWidth(char)
  return width
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return ''
  if (displayWidth(text) <= width) return text
  if (width === 1) return '…'
  let result = ''
  let used = 0
  for (const char of text) {
    const next = charWidth(char)
    if (used + next > width - 1) break
    result += char
    used += next
  }
  return `${result}…`
}

function pad(text: string, width: number): string {
  const current = displayWidth(text)
  return current >= width ? truncate(text, width) : text + ' '.repeat(width - current)
}

/** Wraps text to `width` columns, breaking long tokens by character. */
export function wrapText(text: string, width: number): string[] {
  const limit = Math.max(1, width)
  const lines: string[] = []
  const logicalLines = text.replace(/\r\n?/g, '\n').replace(/\t/g, '  ').split('\n')
  for (const logical of logicalLines) {
    if (logical === '') {
      lines.push('')
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const token of logical.split(/(\s+)/)) {
      if (!token) continue
      const tokenWidth = displayWidth(token)
      if (currentWidth + tokenWidth <= limit) {
        current += token
        currentWidth += tokenWidth
        continue
      }
      if (current) {
        lines.push(current.trimEnd())
        current = ''
        currentWidth = 0
      }
      if (/^\s+$/.test(token)) continue
      for (const char of token) {
        const next = charWidth(char)
        if (currentWidth > 0 && currentWidth + next > limit) {
          lines.push(current)
          current = ''
          currentWidth = 0
        }
        if (next > limit) continue
        current += char
        currentWidth += next
      }
    }
    if (current) lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

function paint(text: string, style: Style, color: boolean): string {
  if (!color || style === 'default' || style === 'assistant') return text
  return `${ANSI[style]}${text}\x1b[0m`
}

function line(text: string, style: Style = 'default'): Line {
  return { text, style }
}

function wrapped(
  text: string,
  width: number,
  firstPrefix: string,
  nextPrefix: string,
  style: Style
): Line[] {
  const prefixWidth = Math.max(displayWidth(firstPrefix), displayWidth(nextPrefix))
  const rows = wrapText(text, Math.max(4, width - prefixWidth))
  return rows.map((row, index) => line(`${index === 0 ? firstPrefix : nextPrefix}${row}`, style))
}

function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) return ''
  let text: string
  if (typeof input === 'string') text = input
  else {
    try {
      text = JSON.stringify(input)
    } catch {
      text = String(input)
    }
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

const TOOL_LABELS: Record<ToolState, string> = {
  pending: '等待中',
  'awaiting-approval': '等待授权',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  denied: '已拒绝'
}

function toolLines(part: Extract<MessagePart, { type: 'tool' }>, width: number): Line[] {
  const out: Line[] = []
  const style: Style =
    part.state === 'failed' || part.state === 'denied'
      ? 'error'
      : part.state === 'running' || part.state === 'awaiting-approval'
        ? 'warning'
        : part.state === 'completed'
          ? 'success'
          : 'tool'
  out.push(line(`⚙ ${part.toolName} · ${TOOL_LABELS[part.state]}`, style))

  const input = formatToolInput(part.input)
  if (input) {
    for (const row of wrapText(`  ${input}`, width).slice(0, 2)) out.push(line(row, 'dim'))
  }
  if (part.output) {
    const outputRows = part.output.replace(/\r/g, '').split('\n')
    const shown = outputRows.slice(0, 4)
    for (const row of shown) {
      const [wrappedRow] = wrapText(`  ${row}`, width)
      out.push(line(wrappedRow, 'dim'))
    }
    if (outputRows.length > shown.length) {
      out.push(line(`  … 还有 ${outputRows.length - shown.length} 行输出`, 'dim'))
    }
  }
  if (part.error) {
    for (const row of wrapText(`  ${part.error}`, width).slice(0, 3)) out.push(line(row, 'error'))
  }
  return out
}

function messageLines(message: ChatMessage, width: number): Line[] {
  const out: Line[] = []
  if (message.role === 'user') {
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        out.push(...wrapped(part.text, width, '› ', '  ', 'user'))
      } else if (part.type === 'attachment') {
        out.push(...wrapped(`📎 ${part.attachment.name}`, width, '  ', '  ', 'dim'))
      }
    }
    return out
  }

  for (const part of message.parts) {
    if (part.type === 'reasoning' && part.text.trim()) {
      out.push(...wrapped(part.text, width, '⋯ ', '  ', 'reasoning'))
    } else if (part.type === 'text' && part.text.trim()) {
      out.push(...wrapped(part.text, width, '', '', 'assistant'))
    } else if (part.type === 'tool') {
      out.push(...toolLines(part, width))
    }
  }

  if (message.status === 'streaming') {
    if (out.length === 0) out.push(line('… 等待模型输出', 'dim'))
    else {
      const last = out[out.length - 1]
      out[out.length - 1] = line(`${last.text}▌`, last.style)
    }
  }
  if (message.status === 'error') {
    out.push(...wrapped(`错误：${message.error ?? '运行失败'}`, width, '✗ ', '  ', 'error'))
  } else if (message.status === 'interrupted') {
    out.push(line('■ 已中断', 'dim'))
  }
  return out
}

function transcriptLines(state: TuiState, width: number): Line[] {
  if (state.messages.length === 0) {
    return [
      line('暂无消息。', 'dim'),
      line(''),
      line('在下方输入内容后按 Enter 开始对话。', 'accent'),
      line(state.mode === 'attach' ? `服务器：${state.label}` : `工作区：${state.workspace}`, 'dim')
    ]
  }
  const lines: Line[] = []
  state.messages.forEach((message, index) => {
    if (index > 0) lines.push(line(''))
    lines.push(...messageLines(message, width))
  })
  return lines
}

function sessionIcon(session: SessionMeta, current: boolean, running: boolean): string {
  const status = current && running ? 'running' : session.status
  if (status === 'running') return '●'
  if (status === 'waiting-permission') return '◐'
  if (status === 'error') return '!'
  return '○'
}

function sidebarLines(state: TuiState, width: number, height: number): Line[] {
  const lines: Line[] = [line(pad('会话', width), 'header')]
  const room = Math.max(0, height - 1)
  const maxStart = Math.max(0, state.sessions.length - room)
  const start = Math.min(
    maxStart,
    Math.max(0, state.sessionIndex - Math.floor(Math.max(0, room - 1) / 2))
  )
  const visible = state.sessions.slice(start, start + room)
  if (visible.length === 0) {
    lines.push(line(pad('  （无会话，Ctrl-T 新建）', width), 'dim'))
  }
  visible.forEach((session, offset) => {
    const index = start + offset
    const current = session.id === state.currentId
    const cursor = state.focus === 'sessions' && index === state.sessionIndex
    const marker = cursor ? '▸' : ' '
    const icon = sessionIcon(session, current, state.running)
    const title = session.title.trim() || '新会话'
    lines.push(
      line(
        pad(`${marker}${icon} ${title}`, width),
        current ? (cursor ? 'reverse' : 'accent') : cursor ? 'reverse' : 'dim'
      )
    )
  })
  while (lines.length < height) lines.push(line(''))
  return lines
}

function statusOf(state: TuiState): { text: string; style: Style } {
  const session = state.sessions.find((candidate) => candidate.id === state.currentId)
  if (state.running) return { text: '运行中', style: 'warning' }
  if (session?.status === 'waiting-permission') return { text: '等待授权', style: 'warning' }
  if (session?.status === 'error') return { text: '错误', style: 'error' }
  if (state.mode === 'attach') return { text: '已连接', style: 'success' }
  return { text: '空闲', style: 'dim' }
}

function headerRow(state: TuiState, columns: number): Segment[] {
  const status = statusOf(state)
  const right = `${state.queued > 0 ? `队列 ${state.queued} · ` : ''}${status.text}`
  const rightWidth = displayWidth(right)
  const mode = state.mode === 'attach' ? '连接' : '本地'
  const left = truncate(
    `ATeam TUI · ${mode} · ${state.label}`,
    Math.max(4, columns - rightWidth - 1)
  )
  const gap = Math.max(1, columns - displayWidth(left) - rightWidth)
  return [
    { text: left, style: 'header' },
    { text: ' '.repeat(gap), style: 'default' },
    { text: right, style: status.style }
  ]
}

function footerHint(state: TuiState): string {
  if (state.overlay === 'permission') {
    return 'y 允许一次 · a 始终允许 · n/Esc 拒绝 · ↑↓ 选择 · Enter 确认'
  }
  if (state.overlay === 'question') {
    return state.questionCustom !== null
      ? 'Enter 提交自定义答案 · Esc 返回选项'
      : '↑↓ 选择 · Space 多选 · Enter 提交 · e 自定义 · Esc 取消'
  }
  if (state.overlay === 'help') return '任意键关闭帮助'
  if (state.focus === 'sessions') {
    return '↑↓/j/k 选择 · Enter 切换 · n 新建 · Tab/Esc 返回输入'
  }
  if (state.running) {
    return 'Enter 排队发送 · ↑↓ 滚动 · Ctrl-C 停止 · Ctrl-D 退出'
  }
  return 'Enter 发送 · Tab 会话 · Ctrl-T 新建 · Ctrl-R 重试 · ? 帮助 · Ctrl-D 退出'
}

function footerRow(state: TuiState, columns: number): Segment[] {
  let prefix = ''
  let style: Style = 'dim'
  if (state.error) {
    prefix = `✗ ${state.error}`
    style = 'error'
  } else if (state.notice) {
    prefix = `• ${state.notice}`
    style = 'accent'
  }
  const hint = footerHint(state)
  const text = truncate(prefix ? `${prefix}  ·  ${hint}` : hint, columns)
  return [{ text, style }]
}

function inputRow(state: TuiState, columns: number): Segment[] {
  const available = Math.max(1, columns - 2)
  const input = state.input
  let start = 0
  while (start < state.cursor && displayWidth(input.slice(start, state.cursor)) > available - 1) {
    start += 1
  }
  let visible = input.slice(start)
  if (displayWidth(visible) > available) {
    visible = truncate(visible, available)
  }
  const cursorInVisible = Math.max(0, state.cursor - start)
  const before = visible.slice(0, cursorInVisible)
  const at = visible.slice(cursorInVisible, cursorInVisible + 1) || ' '
  const after = visible.slice(cursorInVisible + 1)
  return [
    { text: '› ', style: 'accent' },
    { text: before, style: 'default' },
    { text: at, style: 'reverse' },
    { text: after, style: 'default' }
  ]
}

function overlayContent(state: TuiState, width: number): { title: string; lines: Line[] } | null {
  if (state.overlay === 'help') {
    return {
      title: '快捷键',
      lines: [
        line('Enter        发送消息', 'default'),
        line('Tab          会话列表 / 返回输入', 'default'),
        line('Ctrl-T       新建会话', 'default'),
        line('Ctrl-N / P   下一个 / 上一个会话', 'default'),
        line('Ctrl-C       停止运行；无输入时退出', 'default'),
        line('Ctrl-D       退出', 'default'),
        line('Ctrl-R       重试上一条失败消息', 'default'),
        line('↑ ↓          滚动记录', 'default'),
        line('PgUp/PgDn    翻页', 'default'),
        line('?            显示 / 关闭帮助', 'default'),
        line('Esc          关闭弹层 / 取消', 'default')
      ]
    }
  }

  if (state.overlay === 'permission') {
    const request = state.permissions.find((candidate) => candidate.sessionId === state.currentId)
    if (!request) return null
    const lines: Line[] = [
      line(`工具：${request.toolName}`, 'accent'),
      line(`操作：${request.action}`, 'default'),
      ...wrapped(request.resource, width, '资源：', '      ', 'dim'),
      line('')
    ]
    PERMISSION_CHOICES.forEach((choice, index) => {
      const cursor = index === state.permissionIndex
      lines.push(
        line(
          `${cursor ? '▸' : ' '} ${choice.label}  (${choice.hint})`,
          cursor ? 'reverse' : 'default'
        )
      )
    })
    lines.push(line(''))
    lines.push(line('Esc 拒绝 · Ctrl-C 停止运行', 'dim'))
    return { title: '权限确认', lines }
  }

  if (state.overlay === 'question') {
    const request = state.questions.find((candidate) => candidate.sessionId === state.currentId)
    if (!request) return null
    const lines: Line[] = [
      line(request.header, 'accent'),
      ...wrapped(request.question, width, '', '', 'default'),
      line('')
    ]
    request.options.forEach((option, index) => {
      const cursor = index === state.questionIndex
      const checked = state.questionSelected.includes(index)
      const box = request.multiple ? (checked ? '[x] ' : '[ ] ') : ''
      lines.push(
        line(`${cursor ? '▸' : ' '} ${box}${option.label}`, cursor ? 'reverse' : 'default')
      )
      if (option.description) {
        lines.push(...wrapped(option.description, width, '    ', '    ', 'dim'))
      }
    })
    if (request.options.length === 0) lines.push(line('（没有可选答案）', 'dim'))
    lines.push(line(''))
    if (state.questionCustom !== null) {
      lines.push(line(`自定义答案：${state.questionCustom}▌`, 'accent'))
    } else if (request.allowCustom) {
      lines.push(line('按 e 输入自定义答案', 'dim'))
    }
    lines.push(line('Esc 取消提问 · Ctrl-C 停止运行', 'dim'))
    return { title: '选择答案', lines }
  }

  return null
}

function overlayRows(state: TuiState, columns: number, height: number): Segment[][] {
  const content = overlayContent(state, Math.max(8, Math.min(columns - 8, 64)))
  if (!content) return []
  const boxWidth = Math.min(Math.max(24, columns - 6), 72, columns)
  const inner = Math.max(4, boxWidth - 4)
  const wrappedLines: Line[] = []
  for (const item of content.lines) {
    if (displayWidth(item.text) <= inner) {
      wrappedLines.push(item)
    } else {
      for (const row of wrapText(item.text, inner)) wrappedLines.push(line(row, item.style))
    }
  }
  const title = truncate(content.title, Math.max(1, inner - 2))
  const titleWidth = displayWidth(title)
  const top = `┌─ ${title} ${'─'.repeat(Math.max(0, boxWidth - 5 - titleWidth))}┐`
  const bottom = `└${'─'.repeat(Math.max(0, boxWidth - 2))}┘`
  const rows: Segment[][] = [[{ text: pad(top, boxWidth), style: 'dim' }]]
  for (const item of wrappedLines) {
    rows.push([
      { text: '│ ', style: 'dim' },
      { text: pad(item.text, inner), style: item.style },
      { text: ' │', style: 'dim' }
    ])
  }
  rows.push([{ text: pad(bottom, boxWidth), style: 'dim' }])

  const visible = rows.slice(0, height)
  const left = Math.max(0, Math.floor((columns - boxWidth) / 2))
  const topPad = Math.max(0, Math.floor((height - visible.length) / 2))
  const out: Segment[][] = []
  for (let index = 0; index < topPad; index += 1) out.push([])
  for (const row of visible) {
    out.push([{ text: ' '.repeat(left), style: 'default' }, ...row])
  }
  while (out.length < height) out.push([])
  return out
}

function bodyRows(
  state: TuiState,
  columns: number,
  height: number
): { rows: Segment[][]; scrollLimit: number } {
  if (state.overlay) {
    return { rows: overlayRows(state, columns, height), scrollLimit: 0 }
  }
  const wide = columns >= 76
  const sidebarWidth = wide ? Math.min(30, Math.max(22, Math.floor(columns * 0.26))) : 0
  const transcriptWidth = wide ? Math.max(10, columns - sidebarWidth - 2) : columns
  const transcript = transcriptLines(state, transcriptWidth)
  const scrollLimit = Math.max(0, transcript.length - height)
  const start = Math.max(0, scrollLimit - Math.min(state.scroll, scrollLimit))
  const visible = transcript.slice(start, start + height)
  const sidebar = wide ? sidebarLines(state, sidebarWidth, height) : []

  const rows: Segment[][] = []
  for (let index = 0; index < height; index += 1) {
    const row = visible[index]
    if (wide) {
      const side = sidebar[index] ?? line('')
      rows.push([
        { text: pad(side.text, sidebarWidth), style: side.style },
        { text: '│ ', style: 'dim' },
        {
          text: row ? pad(row.text, transcriptWidth) : ' '.repeat(transcriptWidth),
          style: row?.style ?? 'default'
        }
      ])
    } else {
      rows.push([
        { text: row ? pad(row.text, columns) : ' '.repeat(columns), style: row?.style ?? 'default' }
      ])
    }
  }
  return { rows, scrollLimit }
}

function renderRows(rows: Segment[][], columns: number, color: boolean): string {
  return rows
    .map((row) => {
      let output = ''
      let width = 0
      for (const segment of row) {
        if (width >= columns) break
        const text = truncate(segment.text, columns - width)
        output += paint(text, segment.style, color)
        width += displayWidth(text)
      }
      return output + ' '.repeat(Math.max(0, columns - width))
    })
    .join('\r\n')
}

/** Renders a complete frame. The caller moves the cursor to the top-left. */
export function renderView(state: TuiState, options: RenderOptions): RenderResult {
  const rows = Math.max(1, options.rows)
  const columns = Math.max(1, options.columns)
  if (rows < 8 || columns < 24) {
    const message = '终端窗口过小，请调整到至少 24×8。'
    const frame = [
      ' '.repeat(Math.max(0, Math.floor((columns - displayWidth(message)) / 2))) +
        truncate(message, columns)
    ]
    return {
      frame: renderRows(
        frame.map((text) => [{ text, style: 'warning' as Style }]),
        columns,
        options.color
      ),
      scrollLimit: 0
    }
  }

  const bodyHeight = rows - 5
  const body = bodyRows(state, columns, bodyHeight)
  const frameRows: Segment[][] = [
    headerRow(state, columns),
    [{ text: '─'.repeat(columns), style: 'dim' }],
    ...body.rows,
    [{ text: '─'.repeat(columns), style: 'dim' }],
    inputRow(state, columns),
    footerRow(state, columns)
  ]
  return { frame: renderRows(frameRows, columns, options.color), scrollLimit: body.scrollLimit }
}
