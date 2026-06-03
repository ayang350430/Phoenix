import { describe, expect, it } from 'vitest'
import { getMobileUserTabAction, isMobileUserTabSelected } from '../../src/utils/mobileUserTabs.js'

describe('mobile user tabs', () => {
  it('closes the profile drawer before switching to a normal tab', () => {
    expect(getMobileUserTabAction({ key: 'home', nav: '首页' })).toEqual({
      closeProfile: true,
      openProfile: false,
      nav: '首页'
    })
  })

  it('opens the profile drawer without navigating for the mine tab', () => {
    expect(getMobileUserTabAction({ key: 'mine', action: 'profile' })).toEqual({
      closeProfile: false,
      openProfile: true,
      nav: ''
    })
  })

  it('marks mine active only while the profile drawer is open', () => {
    const mineTab = { key: 'mine', action: 'profile' }

    expect(isMobileUserTabSelected(mineTab, '首页', true)).toBe(true)
    expect(isMobileUserTabSelected(mineTab, '首页', false)).toBe(false)
  })

  it('marks consumption tab active on consumption nav', () => {
    const tab = { key: 'consumption', nav: '消费记录' }

    expect(isMobileUserTabSelected(tab, '消费记录', false)).toBe(true)
    expect(isMobileUserTabSelected(tab, '下单记录', false)).toBe(false)
  })
})
