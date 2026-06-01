export function getBatchProblemLines({
  parsedLines = [],
  invalidLines = [],
  prevalidateResults = []
} = {}) {
  const prevalidateBad = prevalidateResults
    .map((result, index) => {
      const line = parsedLines[index]
      if (!line?.valid || result?.valid !== false) return null
      return {
        ...line,
        valid: false,
        error: result.message || '预校验不通过'
      }
    })
    .filter(Boolean)

  return [...invalidLines, ...prevalidateBad]
}

export function removeBatchProblemLines({
  parsedLines = [],
  problemLines = []
} = {}) {
  const badIndexes = new Set(problemLines.map(line => line.index))
  return parsedLines
    .filter(line => line.valid && !badIndexes.has(line.index))
    .map(line => line.raw)
    .join('\n')
}
