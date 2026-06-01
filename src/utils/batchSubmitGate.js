export function getBatchInputSignature(parsedLines = []) {
  return parsedLines.map(line => line?.raw || '').join('\n')
}

export function isBatchPrevalidationPassed({
  parsedLines = [],
  validLines = [],
  prevalidateResults = [],
  prevalidateSignature = '',
  currentSignature = ''
} = {}) {
  if (!parsedLines.length) return false
  if (validLines.length !== parsedLines.length) return false
  if (prevalidateResults.length !== parsedLines.length) return false
  if (!prevalidateSignature || prevalidateSignature !== currentSignature) return false
  return prevalidateResults.every(result => result?.valid === true)
}

export function canSubmitBatch({
  agreed = false,
  connectionOk = false,
  balance = 0,
  totalCost = 0,
  submitting = false,
  activeTypeDisabled = false,
  ...prevalidationState
} = {}) {
  return isBatchPrevalidationPassed(prevalidationState)
    && agreed
    && connectionOk
    && balance >= totalCost
    && !submitting
    && !activeTypeDisabled
}
