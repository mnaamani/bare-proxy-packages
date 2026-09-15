// Runs every example, in order, and fails on the first one that does.
//
// Examples rot faster than anything else in a repository, because nothing is watching
// them. These are all self-contained — each starts the proxy it goes through and shuts it
// down again — so there is no reason for them not to run on every push, and this is what
// runs them.
//
//   node scripts/run-examples.mjs
import { spawnSync } from 'child_process'
import { readdirSync } from 'fs'
import { join } from 'path'

const examples = readdirSync('examples')
  .filter((name) => name.endsWith('.mjs'))
  .sort()

let failed = 0

for (const name of examples) {
  const started = Date.now()
  const { status, stdout, stderr } = spawnSync('bare', [join('examples', name)], {
    encoding: 'utf8'
  })

  if (status === 0) {
    console.log(`✓ ${name} — ${Date.now() - started}ms`)
    continue
  }

  failed++
  console.log(`✗ ${name} — exited ${status}`)
  // The output only matters when it went wrong, and then all of it matters.
  for (const line of `${stdout}${stderr}`.trimEnd().split('\n')) console.log(`    ${line}`)
}

if (failed > 0) {
  console.log(`\n${failed} of ${examples.length} examples failed`)
  process.exit(1)
}

console.log(`\nall ${examples.length} examples ran`)
