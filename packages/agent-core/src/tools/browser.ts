import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { ensureExternalAccess, escapesWorkspace, resolvePath, safeError } from './helpers'
import type { ToolContext } from './types'

export function createBrowserOpenTool(context: ToolContext): Tool {
  return tool({
    description:
      'Open a URL in the desktop app browser and return the page title. Use browser_snapshot afterwards to see the page and its interactive elements.',
    inputSchema: z.object({
      url: z.string().min(1).max(2_000).describe('HTTP or HTTPS URL'),
      newTab: z.boolean().optional().describe('Open in a new tab instead of navigating')
    }),
    execute: async ({ url, newTab = false }: { url: string; newTab?: boolean }, options) => {
      if (!context.browserOpen) return 'Error: browser automation is not available.'
      const allowed = await context.askPermission(
        'webfetch',
        url,
        'browser_open',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the page was not opened.'
      return context.browserOpen(url, newTab)
    }
  })
}

export function createBrowserTabsTool(context: ToolContext): Tool {
  return tool({
    description: 'List the browser tabs of this session and their ids.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.browserTabs) return 'Error: browser automation is not available.'
      return context.browserTabs()
    }
  })
}

export function createBrowserSnapshotTool(context: ToolContext): Tool {
  return tool({
    description:
      'Return the browser page title, URL, visible text, console output and numbered interactive elements. Element refs are valid until the next navigation or snapshot.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserSnapshot) return 'Error: browser automation is not available.'
      return context.browserSnapshot(tabId)
    }
  })
}

export function createBrowserClickTool(context: ToolContext): Tool {
  return tool({
    description: 'Click an interactive element by its snapshot ref.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('Element ref from browser_snapshot'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ ref, tabId }: { ref: string; tabId?: string }) => {
      if (!context.browserClick) return 'Error: browser automation is not available.'
      return context.browserClick(ref, tabId)
    }
  })
}

export function createBrowserTypeTool(context: ToolContext): Tool {
  return tool({
    description:
      'Type text into an input or textarea by snapshot ref. Set submit to submit the surrounding form.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('Element ref from browser_snapshot'),
      text: z.string().max(20_000).describe('Text to enter'),
      submit: z.boolean().optional().describe('Submit the form after typing'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({
      ref,
      text,
      submit = false,
      tabId
    }: {
      ref: string
      text: string
      submit?: boolean
      tabId?: string
    }) => {
      if (!context.browserType) return 'Error: browser automation is not available.'
      return context.browserType(ref, text, submit, tabId)
    }
  })
}

export function createBrowserScreenshotTool(context: ToolContext): Tool {
  return tool({
    description: 'Capture the visible browser page as a PNG screenshot.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserScreenshot) return 'Error: browser automation is not available.'
      return context.browserScreenshot(tabId)
    },
    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'image' in output) {
        return {
          type: 'content',
          value: [
            { type: 'text', text: output.summary },
            {
              type: 'image-data',
              data: output.image.data,
              mediaType: output.image.mimeType
            }
          ]
        }
      }
      return { type: 'text', value: typeof output === 'string' ? output : JSON.stringify(output) }
    }
  })
}

export function createBrowserEvalTool(context: ToolContext): Tool {
  return tool({
    description:
      'Evaluate JavaScript in the current browser page and return a compact JSON result. Use it for page state that the snapshot does not expose.',
    inputSchema: z.object({
      code: z.string().min(1).max(20_000).describe('JavaScript expression or statements'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ code, tabId }: { code: string; tabId?: string }, options) => {
      if (!context.browserEval) return 'Error: browser automation is not available.'
      const allowed = await context.askPermission(
        'shell',
        `browser eval: ${code.replace(/\s+/g, ' ').slice(0, 160)}`,
        'browser_eval',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the code was not evaluated.'
      return context.browserEval(code, tabId)
    }
  })
}

export function createBrowserNetworkTool(context: ToolContext): Tool {
  return tool({
    description: 'List recent network requests made by the current browser page.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserNetwork) return 'Error: browser automation is not available.'
      return context.browserNetwork(tabId)
    }
  })
}

export function createBrowserUploadTool(context: ToolContext): Tool {
  return tool({
    description: 'Attach a workspace file to a file input identified by its snapshot ref.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('File input ref from browser_snapshot'),
      path: z.string().min(1).max(1_000).describe('Workspace-relative file path'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async (
      { ref, path: inputPath, tabId }: { ref: string; path: string; tabId?: string },
      options
    ) => {
      if (!context.browserUpload) return 'Error: browser automation is not available.'
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the file was not uploaded.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'browser_upload',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the file was not uploaded.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return context.browserUpload(ref, filePath, tabId)
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createBrowserCloseTool(context: ToolContext): Tool {
  return tool({
    description: 'Close one browser tab, or the whole browser when no tabId is given.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id to close; omit to close all tabs')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserClose) return 'Error: browser automation is not available.'
      return context.browserClose(tabId)
    }
  })
}
