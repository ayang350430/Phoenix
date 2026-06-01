import { describe, expect, it } from 'vitest'
import { canSubmitBatch, getBatchInputSignature, isBatchPrevalidationPassed } from '../../src/utils/batchSubmitGate.js'

const baseState = {
  parsedLines: [{ raw: 'https://xhslink.com/a 100', valid: true }],
  validLines: [{ raw: 'https://xhslink.com/a 100', valid: true }],
  prevalidateResults: [{ url: 'https://xhslink.com/a', valid: true }],
  prevalidateSignature: 'https://xhslink.com/a 100',
  currentSignature: 'https://xhslink.com/a 100',
  agreed: true,
  connectionOk: true,
  balance: 10,
  totalCost: 1,
  submitting: false,
  activeTypeDisabled: false
}

describe('batch submit gate', () => {
  it('allows submit only after every current input line passes prevalidation', () => {
    expect(canSubmitBatch(baseState)).toBe(true)
  })

  it('blocks submit when any prevalidation result fails', () => {
    expect(canSubmitBatch({
      ...baseState,
      prevalidateResults: [{ url: 'https://xhslink.com/a', valid: false }]
    })).toBe(false)
  })

  it('blocks submit when input changes after prevalidation', () => {
    expect(isBatchPrevalidationPassed({
      ...baseState,
      currentSignature: 'https://xhslink.com/a 200'
    })).toBe(false)
  })

  it('builds a stable signature from parsed raw lines', () => {
    expect(getBatchInputSignature([
      { raw: 'https://xhslink.com/a 100' },
      { raw: 'https://xhslink.com/b 200' }
    ])).toBe('https://xhslink.com/a 100\nhttps://xhslink.com/b 200')
  })
})
