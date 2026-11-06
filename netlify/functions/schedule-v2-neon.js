// Netlify deploys this ESM JavaScript entry instead of wrapping a .mts entry
// in CommonJS require(), which failed at runtime with ERR_REQUIRE_ESM.
// The business logic stays in the TypeScript source and is bundled as a module.
import scheduleV2Neon from './schedule-v2-neon.mts'

export default scheduleV2Neon

export const config = { path: '/api/schedule-v2' }
