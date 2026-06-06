/** 根据用户名生成稳定的默认头像配色 */
const AVATAR_PALETTE = [
  { bg: 'linear-gradient(145deg, #6b9bff 0%, #2f6df6 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #4ade80 0%, #059669 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #fb923c 0%, #ea580c 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #f472b6 0%, #db2777 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #a78bfa 0%, #7c3aed 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #22d3ee 0%, #0891b2 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #f87171 0%, #dc2626 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #86efac 0%, #16a34a 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #fcd34d 0%, #d97706 100%)', fg: '#ffffff' },
  { bg: 'linear-gradient(145deg, #60a5fa 0%, #2563eb 100%)', fg: '#ffffff' }
]

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export function displayUserName(userOrName) {
  if (typeof userOrName === 'string') return userOrName.trim() || '用户'
  const u = userOrName || {}
  return (u.real_name || u.nickname || u.username || '用户').trim()
}

export function getUserInitial(name) {
  const s = displayUserName(name)
  const ch = s[0]
  if (!ch) return '?'
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

export function getAvatarColors(name) {
  const key = displayUserName(name) || '?'
  return AVATAR_PALETTE[hashString(key) % AVATAR_PALETTE.length]
}

export function getAvatarStyle(name, size) {
  const { bg, fg } = getAvatarColors(name)
  const n = Number(size) || 34
  return {
    background: bg,
    color: fg,
    width: `${n}px`,
    height: `${n}px`,
    fontSize: `${Math.max(12, Math.round(n * 0.42))}px`
  }
}
