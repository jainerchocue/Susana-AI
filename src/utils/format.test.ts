import { describe, expect, it } from 'vitest'
import { formatNumber, formatPercent } from './format'

describe('formatNumber', () => {
  it('formats with the default locale grouping', () => {
    expect(formatNumber(1234.5)).toBe('1.234,5')
  })

  it('respects a custom max fraction digits', () => {
    expect(formatNumber(1.239, 2)).toBe('1,24')
  })
})

describe('formatPercent', () => {
  it('appends the percent sign', () => {
    expect(formatPercent(82.4)).toBe('82,4%')
  })
})
