import { config } from 'dotenv'

// Must be imported before any module that reads env at module scope
// (platform/src/embed.ts throws without EMBED_URL). Never overrides
// already-set vars, so explicit SB_* context from the parent stays intact.
config({ path: new URL('../../../.env', import.meta.url).pathname })
