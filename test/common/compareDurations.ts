// Usage: node test/common/compareDurations.js <baselineDir> <currentDir> <slowerFile>
// Writes every test that got more than 2x slower than master's baseline to <slowerFile>,
// one line each, so CI can post them as a PR comment. Never fails: durations are noisy.
import fs from 'fs'
import path from 'path'

const [baselineDir, currentDir, slowerFile] = process.argv.slice(2)
const FACTOR = 2
// Ignore jumps under 10s: master's own run-to-run spread on the world-event tests
// (nether, fishing) is 5-10s, so anything smaller is server/network jitter.
const MIN_REGRESSION_MS = 10000

const slower: string[] = []
for (const file of fs.readdirSync(currentDir).filter(f => f.startsWith('durations-')).sort()) {
  const baselineFile = path.join(baselineDir, file)
  if (!fs.existsSync(baselineFile)) {
    console.log(`${file}: no baseline yet, skipping`)
    continue
  }
  // JSON.parse stringifies the Buffer (as utf8)
  const baseline: Record<string, number> = JSON.parse(fs.readFileSync(baselineFile) as unknown as string)
  const current: Record<string, number> = JSON.parse(fs.readFileSync(path.join(currentDir, file)) as unknown as string)
  console.log(`\n${file}`)
  for (const [title, ms] of Object.entries(current)) {
    const base = baseline[title]
    if (base === undefined) continue
    const regressed = ms > base * FACTOR && ms - base > MIN_REGRESSION_MS
    const line = `${String(base).padStart(7)}ms -> ${String(ms).padStart(7)}ms  ${title}`
    if (regressed) slower.push(line)
    console.log(`  ${regressed ? 'SLOWER' : '      '} ${line}`)
  }
}
if (slower.length > 0) {
  console.log(`\n${slower.length} test(s) got more than ${FACTOR}x slower than master`)
  fs.writeFileSync(slowerFile, slower.join('\n') + '\n')
}
