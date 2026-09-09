import fs from 'fs'
import path from 'path'
import { resolveDefaultBoqPackSeedPath } from '../seedPath'

describe('resolveDefaultBoqPackSeedPath', () => {
  it('finds the shipped Issue Tracker workbook', () => {
    const found = resolveDefaultBoqPackSeedPath()
    expect(found).toBeTruthy()
    expect(fs.existsSync(found as string)).toBe(true)
    expect(path.basename(found as string).toLowerCase()).toMatch(
      /issue tracker\.xlsx$/,
    )
  })
})
