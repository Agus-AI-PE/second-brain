import { fileURLToPath } from 'node:url'
import { McpClient } from '@anvia/mcp'

/** Directory of this source file: apps/platform/src/ */
const HERE = fileURLToPath(new URL('.', import.meta.url))

/**
 * Spawns the second-brain-memory MCP server over stdio for one request
 * context. The MCP server reads SB_TELEGRAM_USER_ID / SB_CHAT_ID /
 * SB_ATTACHMENT_* from its env — trusted values bound by the host (this
 * process), never chosen by the LLM.
 */
export function createMcpClient(input: {
  telegramUserId: string
  chatId: string
  attachment?: { sourceUrl: string; sourceType: string }
}): McpClient {
  // stdio transport REPLACES the child environment, so inherit the parent's
  // (DATABASE_URL, EMBED_URL, ...) and layer the trusted SB_* context on top.
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
    SB_TELEGRAM_USER_ID: input.telegramUserId,
    SB_CHAT_ID: input.chatId,
    ...(input.attachment
      ? { SB_ATTACHMENT_SOURCE_URL: input.attachment.sourceUrl, SB_ATTACHMENT_SOURCE_TYPE: input.attachment.sourceType }
      : {})
  }
  const { command, args } = mcpServerCommand()
  return new McpClient({
    name: 'second-brain-memory',
    transport: { type: 'stdio', command, args, env },
    // Our MCP server uses @modelcontextprotocol/server serveStdio (2025-era).
    // The client default pins the 2026-07-28 revision with no fallback, which
    // makes version negotiation fail; allow fallback instead.
    versionNegotiation: { mode: 'auto' }
  })
}

/** Resolve the MCP server launch command. Throws when misconfigured. */
export function mcpServerCommand(): { command: string; args: string[] } {
  const raw = process.env.MCP_SERVER_COMMAND
  if (raw) {
    const [command, ...args] = raw.split(' ').filter(Boolean)
    return { command: command!, args }
  }
  // Dev default: tsx binary installed in the mcp-server workspace.
  // HERE = apps/platform/src/ → ../.. = repo root.
  return {
    command: `${HERE}../../mcp-server/node_modules/.bin/tsx`,
    args: [`${HERE}../../mcp-server/src/index.ts`]
  }
}
