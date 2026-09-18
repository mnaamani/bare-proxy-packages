// Runs every example, in order, and fails on the first one that does.
//
// Examples rot faster than anything else in a repository, because nothing is watching
// them. These are all self-contained - each starts the proxy it goes through and shuts it
// down again - so there is no reason for them not to run on every push, and this is what
// runs them.
//
//   node scripts/run-examples.mjs
import { spawnSync } from 'child_process'
import { readdirSync } from 'fs'
import { join } from 'path'

// `bare` is a .cmd shim on Windows, which Node will not spawn without a shell - it refuses
// rather than running it, since a .cmd goes through the command interpreter and its
// arguments with it. The argument is quoted by hand because the shell is then the one
// splitting them.
const WINDOWS = process.platform === 'win32'

const examples = readdirSync('examples')
  .filter((name) => name.endsWith('.mjs'))
  .sort()

let failed = 0

for (const name of examples) {
  const started = Date.now()
  const example = join('examples', name)
  const { status, stdout, stderr, error } = spawnSync(
    WINDOWS ? 'bare.cmd' : 'bare',
    [WINDOWS ? `"${example}"` : example],
    { encoding: 'utf8', shell: WINDOWS }
  )

  if (status === 0) {
    console.log(`ok ${name} - ${Date.now() - started}ms`)
    continue
  }

  // A spawn that never happened has no exit status and no output to print, so say what
  // went wrong instead of reporting an exit of `null` and two undefineds.
  if (error) {
    failed++
    console.log(`FAIL ${name} - could not run bare: ${error.message}`)
    continue
  }

  failed++
  console.log(`FAIL ${name} - exited ${status}`)
  // The output only matters when it went wrong, and then all of it matters.
  for (const line of `${stdout}${stderr}`.trimEnd().split('\n')) console.log(`    ${line}`)
}

if (failed > 0) {
  console.log(`\n${failed} of ${examples.length} examples failed`)
  process.exit(1)
}

console.log(`\nall ${examples.length} examples ran`)
