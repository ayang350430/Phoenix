import crypto from 'crypto'

/**
 * 短编号：4 个大写英文字母 + 6 位数字，形如 KXAR482913（共 10 位，无前缀）。
 * 用于订单号 / 批次号 / 流水号 / 补单号等，替代原先冗长的「PREFIX-时间戳-随机」格式。
 *
 * 组合空间 = 26^4 × 10^6 ≈ 4.57×10^11，配合 uniqueCode() 的查重，实际不会撞号。
 * 注意：纯随机、不含时间信息，业务里凡是靠它「相等匹配」的（如退款按 order_no 对账）
 * 不受影响；凡是靠它「排序/解析时间」的才需注意——本项目排序用 created_at，不依赖编号。
 */
export function shortCode() {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(65 + crypto.randomInt(26)) // A-Z
  for (let i = 0; i < 6; i++) s += crypto.randomInt(10)                            // 0-9
  return s
}

/**
 * 生成在指定表列上唯一的短编号（生成即查重，撞了重试）。
 * @param {import('knex').Knex | import('knex').Knex.Transaction} qb  db 或事务（建议传事务，能看到同事务未提交行）
 * @param {string} table
 * @param {string} column
 * @param {Set<string>} [taken]  可选：本批次内已用编号集合，避免同批次内重复（无需额外查询）
 * @returns {Promise<string>}
 */
export async function uniqueCode(qb, table, column, taken) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = shortCode()
    if (taken && taken.has(code)) continue
    const row = await qb(table).where(column, code).first()
    if (!row) {
      if (taken) taken.add(code)
      return code
    }
  }
  throw new Error(`无法为 ${table}.${column} 生成唯一短编号`)
}
