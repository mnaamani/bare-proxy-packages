// Every tracked file in this repository is ASCII, and this is what keeps it that way.
//
// Nothing else would notice if it stopped being true: prettier formats an em dash as
// happily as a hyphen, and the characters that get in are the ones that look like the
// ASCII they replace - a curly quote for an apostrophe, U+2013 for a minus sign. They
// arrive by being pasted in, one edit at a time, and then turn up in npm descriptions,
// error messages and terminal output where the encoding is somebody else's to get wrong.
//
//   node scripts/check-ascii.mjs
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

// What to write instead, for the characters worth naming. Anything not listed is still a
// failure - the suggestion is a convenience, not the rule.
const INSTEAD = {
  0x00a0: 'a space',
  0x00a7: "'section'",
  0x00b7: "'/' or '-'",
  0x2010: "'-'",
  0x2013: "'-'",
  0x2014: "'-'",
  0x2018: "'",
  0x2019: "'",
  0x201c: '"',
  0x201d: '"',
  0x2026: "'...'",
  0x2192: "'->'",
  0x2500: "'-'",
  0x2713: "'ok'",
  0x2717: "'FAIL'",
  0xfeff: 'nothing (byte order mark)'
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

let failed = false
let checked = 0

for (const file of files) {
  const bytes = readFileSync(file)

  // A NUL says this is not text, and a file that is not text has no business being read
  // a character at a time. There are none in the repository today; this is for the day
  // somebody adds a fixture.
  if (bytes.includes(0)) continue

  checked++

  const lines = bytes.toString('utf8').split('\n')

  for (let i = 0; i < lines.length; i++) {
    for (let j = 0; j < lines[i].length; j++) {
      const point = lines[i].codePointAt(j)
      if (point < 0x80) continue

      failed = true
      const code = `U+${point.toString(16).toUpperCase().padStart(4, '0')}`
      const instead = INSTEAD[point] ? ` - write ${INSTEAD[point]} instead` : ''
      const char = String.fromCodePoint(point)
      console.log(`FAIL ${file}:${i + 1}:${j + 1} - ${code} ${char}${instead}`)

      // Surrogate pairs are two units and one character; skip the low half so an emoji
      // is reported once, at the position it starts.
      if (point > 0xffff) j++
    }
  }
}

if (!failed) console.log(`ok ascii - ${checked} files`)

if (failed) process.exit(1)
