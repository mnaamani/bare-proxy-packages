// Whether one package can be published right now, asked before anything is uploaded.
//
// Publishing is the one thing in this repository that cannot be undone: npm allows an
// unpublish for 72 hours and then the version is spent forever, and a dependency range
// that resolves to nothing is an install error for whoever believed the release. The
// packages depend on each other and version independently, so the order matters - shipping
// barex-any-proxy-agent before the barex-proxy-agent it asks for leaves a package on the
// registry that nobody can install.
//
//   node scripts/check-publishable.mjs <package-name> <version>
//
// The version is the one the release tag claims. It has to be the one in the manifest too:
// a tag is written by hand, and that is exactly the kind of thing to get wrong.
import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// npm is a .cmd shim on Windows, which Node will not spawn without a shell.
const WINDOWS = process.platform === 'win32'
const NPM = WINDOWS ? 'npm.cmd' : 'npm'

function npm(args) {
  return execFileSync(NPM, WINDOWS ? args.map((arg) => `"${arg}"`) : args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: WINDOWS
  })
}

const [name, tagged] = process.argv.slice(2)

if (!name || !tagged) {
  console.log('FAIL usage: node scripts/check-publishable.mjs <package-name> <version>')
  process.exit(1)
}

const directory = join('packages', name)

if (!existsSync(directory)) {
  console.log(`FAIL ${name} - no such package in packages/`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
let failed = false

function fail(message) {
  failed = true
  console.log(`FAIL ${name} - ${message}`)
}

// Every version this package has on the registry, or null when it has none at all. A 404
// is the answer for a package that has never been published, not an error.
function published(target) {
  try {
    const versions = JSON.parse(npm(['view', target, 'versions', '--json']))
    return Array.isArray(versions) ? versions : [versions]
  } catch {
    return null
  }
}

if (manifest.version !== tagged) {
  fail(`the tag says ${tagged}, package.json says ${manifest.version}`)
}

if (manifest.private) {
  fail('marked private, so npm would refuse it')
}

const already = published(name)

if (already?.includes(manifest.version)) {
  fail(`${manifest.version} is already on the registry and cannot be replaced`)
} else if (already === null) {
  console.log(`ok ${name} - first release, the name is free`)
} else {
  console.log(`ok ${name} - ${manifest.version} is new (latest published: ${already.at(-1)})`)
}

// The packages in this repository that this one depends on have to be reachable from the
// registry by the time this is installed. `npm view <name>@<range>` answers with nothing
// when the range matches no published version, which is the case worth catching.
for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
  if (!existsSync(join('packages', dependency))) continue

  const versions = published(dependency)

  if (versions === null) {
    fail(`depends on ${dependency}@${range}, which has never been published - publish it first`)
    continue
  }

  const matched = npm(['view', `${dependency}@${range}`, 'version', '--json']).trim()

  if (matched === '') {
    fail(
      `depends on ${dependency}@${range}, which matches nothing published (${versions.at(-1)} is the latest)`
    )
  } else {
    console.log(`ok ${name} - ${dependency}@${range} resolves on the registry`)
  }
}

if (failed) process.exit(1)
