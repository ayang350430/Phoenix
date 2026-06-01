import { describe, expect, it } from 'vitest'
import { getBatchProblemLines, removeBatchProblemLines } from '../../src/utils/batchProblemLines.js'

const duplicateLines = [
  {
    index: 1,
    raw: 'http://xhslink.com/o/8VSQgKzTMi2 50',
    url: 'http://xhslink.com/o/8VSQgKzTMi2',
    quantity: 50,
    valid: true
  },
  {
    index: 2,
    raw: 'http://xhslink.com/o/8VSQgKzTMi2 50',
    url: 'http://xhslink.com/o/8VSQgKzTMi2',
    quantity: 50,
    valid: true
  }
]

describe('batch problem lines', () => {
  it('marks only the failed duplicate row instead of every matching URL', () => {
    const problems = getBatchProblemLines({
      parsedLines: duplicateLines,
      invalidLines: [],
      prevalidateResults: [
        { url: duplicateLines[0].url, valid: true },
        { url: duplicateLines[1].url, valid: false, message: '重复链接' }
      ]
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ index: 2, error: '重复链接' })
  })

  it('keeps the first valid duplicate when removing problem rows', () => {
    const kept = removeBatchProblemLines({
      parsedLines: duplicateLines,
      problemLines: [{ ...duplicateLines[1], valid: false, error: '重复链接' }]
    })

    expect(kept).toBe('http://xhslink.com/o/8VSQgKzTMi2 50')
  })
})
