// The spec reporter, plus a JSON file of { "<test full title>": <ms> } for every
// passing test, written to $DURATIONS. CI compares it against master's run.
import fs from 'fs'
import { reporters, Runner } from 'mocha'
import type { MochaOptions, Test } from 'mocha'

class DurationsReporter extends reporters.Spec {
  constructor (runner: Runner, options?: MochaOptions) {
    super(runner, options)
    const durations: Record<string, number | undefined> = {}
    runner.on(Runner.constants.EVENT_TEST_PASS, (test: Test) => {
      durations[test.fullTitle()] = test.duration
    })
    runner.once(Runner.constants.EVENT_RUN_END, () => {
      if (process.env['DURATIONS']) fs.writeFileSync(process.env['DURATIONS'], JSON.stringify(durations, null, 2))
    })
  }
}

// mocha loads reporters with require()
export { DurationsReporter as 'module.exports' }
