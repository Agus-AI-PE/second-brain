import { config } from 'dotenv'

// Must be imported before any module that reads env at module scope
// (platform/src/embed.ts throws without EMBED_URL). Never overrides
// already-set vars, so explicit SB_* context from the parent stays intact.
// quiet: the banner would pollute stdout and break the stdio JSON-RPC stream.
config({ path: new URL('../../../.env', import.meta.url).pathname, quiet: true })
