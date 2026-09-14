// Every package ships a handwritten index.d.ts, and nothing about a declaration file makes
// it agree with the code it describes: `tsc` reads the .d.ts and never opens the .mjs. This
// is what holds the two together — the names each side exports, compared.
//
// Run under Node, since the TypeScript compiler is a Node package; the runtime exports come
// from Bare, since the packages import bare-tcp and friends and will not load anywhere else.
//
//   node scripts/check-typings.mjs
import { execFileSync } from 'child_process'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const PACKAGES = readdirSync('packages').sort()

// The value exports a declaration file names — what `import { x }` can actually reach at
// runtime. Types are left out: they have no runtime counterpart to compare against.
function declared(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
  const names = new Set()

  for (const statement of source.statements) {
    const exported = ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (exported && statement.name) names.add(statement.name.text)
    } else if (ts.isVariableStatement(statement)) {
      if (!exported) continue
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (statement.isTypeOnly || !ts.isNamedExports(statement.exportClause)) continue
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly) names.add(element.name.text)
      }
    }
  }

  return names
}

// What the package actually exports, asked of Bare.
function actual(packages) {
  const script = `
    Promise.all(${JSON.stringify(packages)}.map((name) => import(name)))
      .then((modules) => {
        const exports = {}
        for (let i = 0; i < modules.length; i++) {
          exports[${JSON.stringify(packages)}[i]] = Object.keys(modules[i]).sort()
        }
        console.log(JSON.stringify(exports))
      })
      .catch((err) => {
        console.error(err)
        Bare.exit(1)
      })
  `

  return JSON.parse(execFileSync('bare', ['-e', script], { encoding: 'utf8' }))
}

const runtime = actual(PACKAGES)
let failed = false

for (const name of PACKAGES) {
  const types = declared(join('packages', name, 'index.d.ts'))
  const values = new Set(runtime[name])

  const missing = [...types].filter((exported) => !values.has(exported)).sort()
  const undeclared = [...values].filter((exported) => !types.has(exported)).sort()

  if (missing.length === 0 && undeclared.length === 0) {
    console.log(`✓ ${name} — ${types.size} exports`)
    continue
  }

  failed = true
  // Named apart, because they are different mistakes: the first is a declaration of
  // something that is not there, which fails at run time for whoever believed it; the
  // second is a working export nobody can discover.
  for (const exported of missing) {
    console.log(`✗ ${name} — declared but not exported: ${exported}`)
  }
  for (const exported of undeclared) {
    console.log(`✗ ${name} — exported but not declared: ${exported}`)
  }
}

if (failed) process.exit(1)
