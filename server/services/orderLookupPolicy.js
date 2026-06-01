export function filterLookupOrders(orders) {
  return orders.filter(order => order.order_status !== 'refunded')
}
