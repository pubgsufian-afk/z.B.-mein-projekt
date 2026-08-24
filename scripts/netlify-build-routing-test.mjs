import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const netlifyConfig = await readFile('netlify.toml', 'utf8')

assert.match(
  netlifyConfig,
  /ignore\s*=\s*"test \\\"\$HABUN_SKIP_SITE_BUILD\\\" = \\\"1\\\""/,
  'Netlify builds must only be skipped when the site-specific HABUN_SKIP_SITE_BUILD flag is enabled',
)
assert.doesNotMatch(
  netlifyConfig,
  /31fdd344-8ffd-45ff-8a4d-031c5bb879dc/,
  'The primary Habun site id must not be hard-coded into build routing',
)

console.log('Netlify site-specific build routing test passed')
