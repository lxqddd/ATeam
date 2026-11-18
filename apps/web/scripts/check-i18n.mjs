#!/usr/bin/env node
// 扫描 Vue 模板中的硬编码可见文案（NFR-I18N-001 的轻量防护）。
// 规则（启发式）：
//   1. 文本节点中未被 {{ }} 插值包裹的字母/CJK 字符
//   2. title/placeholder/label/aria-label 等静态属性中的字面量文案
// 命中即以非零退出码失败。已知噪声（如纯 ASCII 符号、品牌名）由文件内
// 白名单注释控制，不设全局例外。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url))
const TEXT_NODE = />([^<>{}]*[A-Za-z一-龥][^<>{}]*)</g
const STATIC_ATTR =
  /(?<![:@\-])\b(title|placeholder|label|aria-label)="([^"]*[A-Za-z一-龥][^"]*)"/g
// 白名单：品牌名、版本号片段、语言切换器的原生语言名（约定不翻译）
const ALLOWED_TEXT = ['ATeam', 'OK ·', 'v0.1.0', '简体中文', 'English']

function listVueFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      listVueFiles(full, out)
    } else if (entry.name.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

function stripInterpolations(template) {
  return template.replace(/{{[\s\S]*?}}/g, '')
}

function isAllowed(text) {
  return ALLOWED_TEXT.some((token) => text.includes(token))
}

const findings = []
for (const file of listVueFiles(SRC_ROOT)) {
  const content = readFileSync(file, 'utf8')
  const match = content.match(/<template[^>]*>([\s\S]*)<\/template>/)
  if (!match) {
    continue
  }
  const rel = file.slice(file.indexOf('src'))
  const lineAt = (index) => content.slice(0, index).split('\n').length

  const stripped = stripInterpolations(match[1])
  for (const m of stripped.matchAll(TEXT_NODE)) {
    const text = m[1].trim()
    if (text && !isAllowed(text)) {
      findings.push(`${rel}:${lineAt(m.index)} 文本节点疑似硬编码文案: "${text.slice(0, 60)}"`)
    }
  }
  for (const m of content.matchAll(STATIC_ATTR)) {
    // 静态属性命中即报告（动态绑定以 : 开头，不会被此规则命中）
    findings.push(
      `${rel}:${lineAt(m.index)} 静态属性 "${m[1]}" 疑似硬编码文案: "${m[2].slice(0, 60)}"`,
    )
  }
}

if (findings.length > 0) {
  console.error(`发现 ${findings.length} 处疑似硬编码文案：`)
  for (const finding of findings) {
    console.error(`  ${finding}`)
  }
  process.exit(1)
}
console.log('i18n 扫描通过：未发现硬编码文案')
