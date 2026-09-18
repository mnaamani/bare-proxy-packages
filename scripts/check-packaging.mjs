// What a consumer gets, checked by being one.
//
// `npm test` runs against the workspace, where npm has symlinked the six packages into
// each other's node_modules. That tree is not the one anybody installs: it has the test
// files in it, it has every devDependency hoisted to the root where an accidental import
// resolves happily, and it reaches the other packages without going through their
// `exports`. A file left out of `files`, a runtime import declared as a devDependency, an
// `exports` map pointing at a path that is not shipped - none of it shows up until the
// package is installed from the registry, which is after publishing, which is too late.
//
// So: pack the tarballs npm would upload, install them into a directory that is not the
// workspace, and import each one under Bare.
//
//   node scripts/check-packaging.mjs
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const PACKAGES = readdirSync('packages').sort()

const root = mkdtempSync(join(tmpdir(), 'barex-packaging-'))
const tarballs = join(root, 'tarballs')
const consumer = join(root, 'consumer')

mkdirSync(tarballs)
mkdirSync(consumer)

// `npm` and `bare` are both .cmd shims on Windows, and Node will not spawn one of those
// without a shell - it refuses, rather than running it, since a .cmd goes through the
// command interpreter and its arguments with it. So: a shell there, and the arguments
// quoted by hand, because the shell is now the one splitting them.
const WINDOWS = process.platform === 'win32'

function run(command, args, cwd) {
  return execFileSync(
    WINDOWS ? `${command}.cmd` : command,
    WINDOWS ? args.map((arg) => `"${arg}"`) : args,
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: WINDOWS }
  )
}

try {
  // `npm pack` is the only thing that knows what `files` means, so ask it rather than
  // reimplementing the answer.
  run('npm', ['pack', '--workspaces', '--pack-destination', tarballs, '--silent'], process.cwd())

  const packed = readdirSync(tarballs).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== PACKAGES.length) {
    console.log(`FAIL packed ${packed.length} tarballs, expected ${PACKAGES.length}`)
    process.exit(1)
  }

  // The packages depend on each other by version range, and those versions are not on the
  // registry yet - a first release has nothing to resolve `^0.1.0` against. Overrides point
  // every one of them at the tarball built a moment ago, so the tree is built out of what
  // is about to be published and never reaches for a published copy instead.
  const overrides = {}
  for (const name of PACKAGES) {
    const tarball = packed.find((file) => file.startsWith(`${name}-`))
    if (!tarball) {
      console.log(`FAIL ${name} - no tarball was packed for it`)
      process.exit(1)
    }
    overrides[name] = `file:${join(tarballs, tarball)}`
  }

  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'barex-packaging-consumer',
        version: '0.0.0',
        private: true,
        dependencies: Object.fromEntries(Object.entries(overrides)),
        overrides
      },
      null,
      2
    ) + '\n',
    { flag: 'w' }
  )

  run('npm', ['install', '--no-audit', '--no-fund', '--silent'], consumer)

  // Imported under Bare, not Node: these packages import bare-tcp and friends, which only
  // exist there. Every export the declaration file promises has to arrive, since a file
  // missing from `files` is most visible as an export that is suddenly not there.
  const smoke = PACKAGES.map((name) => JSON.stringify(name)).join(', ')
  writeFileSync(
    join(consumer, 'smoke.mjs'),
    // Caught per package and reported in a line: an unhandled import error prints the
    // module resolver's whole candidate list, which buries the one fact worth reading.
    `const names = [${smoke}]\n` +
      `let failed = false\n` +
      `for (const name of names) {\n` +
      `  let exports\n` +
      `  try {\n` +
      `    exports = Object.keys(await import(name))\n` +
      `  } catch (err) {\n` +
      `    failed = true\n` +
      `    console.log('FAIL ' + name + ' - ' + err.message.split('\\n')[0])\n` +
      `    continue\n` +
      `  }\n` +
      `  if (exports.length === 0) {\n` +
      `    failed = true\n` +
      `    console.log('FAIL ' + name + ' - installed, but exports nothing')\n` +
      `    continue\n` +
      `  }\n` +
      `  console.log('ok ' + name + ' - ' + exports.length + ' exports from the tarball')\n` +
      `}\n` +
      `if (failed) Bare.exit(1)\n`
  )

  process.stdout.write(run('bare', ['smoke.mjs'], consumer))
} catch (err) {
  if (err.stdout) process.stdout.write(err.stdout)
  if (err.stderr) process.stderr.write(err.stderr)
  console.log('FAIL packaging - see above')
  process.exit(1)
} finally {
  rmSync(root, { recursive: true, force: true })
}
