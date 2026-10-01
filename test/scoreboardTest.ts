// ScoreBoard.items order, on a fake bot with a real registry
import assert from 'assert'
import prismarineRegistry from 'prismarine-registry'
import scoreboardLoader from '../lib/scoreboard.ts'

describe('scoreboard items order', () => {
  function scoreBoard (names: Array<[string, number]>) {
    const bot: any = { registry: prismarineRegistry('1.20.4'), teamMap: {} }
    const ScoreBoard = scoreboardLoader(bot)
    const board = new ScoreBoard({ name: 'kills', displayText: 'Kills' })
    for (const [name, value] of names) board.add(name, value)
    return board.items.map(item => `${item.name}=${item.value}`)
  }

  it('sorts like the vanilla sidebar: higher score first, then the name ignoring case', () => {
    const expected = ['zed=5', 'alice=1', 'Bob=1', 'carol=1', 'dave=0']
    assert.deepStrictEqual(scoreBoard([['dave', 0], ['carol', 1], ['Bob', 1], ['alice', 1], ['zed', 5]]), expected)
    assert.deepStrictEqual(scoreBoard([['alice', 1], ['Bob', 1], ['carol', 1], ['zed', 5], ['dave', 0]]), expected)
    assert.deepStrictEqual(scoreBoard([['Bob', 1], ['zed', 5], ['alice', 1], ['dave', 0], ['carol', 1]]), expected)
  })
})
