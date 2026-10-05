// Notification wording for each order status (same words the server sends).
const tzs = (n) => `${Math.round(n || 0).toLocaleString('en-US')} TZS`;

export function clientMessage(o, riderName) {
  const first = (riderName || 'Your rider').split(' ')[0];
  return {
    placed: ['Order sent to the station', `${o.code}: ${o.litres} L ${o.product_name} is waiting for the station to accept.`],
    accepted: ['Station accepted your order', 'Finding a rider to bring your fuel.'],
    assigned: [`${first} is collecting your fuel`, 'Track the rider on the map in Wese.'],
    picked_up: ['Your fuel is collected', `${first} is about to leave the station.`],
    on_the_way: [`${first} is on the way`, 'Open Wese to watch them on the map.'],
    arrived: [`${first} has arrived`, 'Give your 4-digit code only after the fuel is in your tank.'],
    delivered: ['Fuel delivered', `Thank you for using Wese. Total paid: ${tzs(o.total)}.`],
    cancelled: ['Order cancelled', o.payment_status === 'refunded' ? 'Your payment has been refunded.' : (o.cancel_reason || 'Your order was cancelled.')],
    rejected: ['The station declined your order', `${o.cancel_reason || 'Declined'}.${o.payment_status === 'refunded' ? ' Your payment has been refunded.' : ''}`],
  }[o.status] || null;
}
