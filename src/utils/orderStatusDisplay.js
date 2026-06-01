export const userOrderStatusDisplay = {
  processing: { label: '处理中', color: '#5b8def', bg: '#eef3ff', border: '#5b8def' },
  completed: { label: '已完成', color: '#42c978', bg: '#f0fff4', border: '#42c978' },
  refunded: { label: '已退款', color: '#e8a735', bg: '#fffbf0', border: '#e8a735' }
}

export function getUserOrderStatusDisplay(status) {
  if (status === 'completed') return userOrderStatusDisplay.completed
  if (status === 'refunded') return userOrderStatusDisplay.refunded
  return userOrderStatusDisplay.processing
}
