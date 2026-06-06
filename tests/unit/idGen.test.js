import { describe, it, expect } from 'vitest'
import { shortCode, uniqueCode } from '../../server/utils/idGen.js'

const FORMAT = /^[A-Z]{4}\d{6}$/   // 4 字母 + 6 数字，共 10 位

describe('shortCode — 4字母+6数字', () => {
  it('格式恒为 KXAR482913 这种（多次抽样）', () => {
    for (let i = 0; i < 2000; i++) {
      const c = shortCode()
      expect(c).toHaveLength(10)
      expect(c).toMatch(FORMAT)
    }
  })

  it('随机性足够（基本不重复）', () => {
    const set = new Set()
    for (let i = 0; i < 2000; i++) set.add(shortCode())
    expect(set.size).toBeGreaterThan(1990)
  })
})

describe('uniqueCode — 生成即查重', () => {
  // 模拟 knex：qb(table).where(col, code).first()
  const qbFree = () => ({ where: () => ({ first: async () => null }) })
  const qbTaken = () => ({ where: () => ({ first: async () => ({ id: 1 }) }) })

  it('无冲突时返回合法短编号', async () => {
    const code = await uniqueCode(qbFree, 'orders', 'order_no')
    expect(code).toMatch(FORMAT)
  })

  it('持续撞号（查重一直命中）时抛错，不会死循环', async () => {
    await expect(uniqueCode(qbTaken, 'orders', 'order_no')).rejects.toThrow(/唯一/)
  })

  it('taken 集合内的编号会被跳过', async () => {
    const taken = new Set()
    const a = await uniqueCode(qbFree, 'orders', 'order_no', taken)
    expect(taken.has(a)).toBe(true)
    const b = await uniqueCode(qbFree, 'orders', 'order_no', taken)
    expect(b).not.toBe(a)
  })
})
