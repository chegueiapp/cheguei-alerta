// Mesma lista usada em cron-process-billing/_shared/plano-calculo.ts (cheguei-app) pra
// separar pagamento online (Asaas) de pagamento local/na entrega -- mantida em sincronia
// com aquele arquivo se a lista mudar por lá.
const OFFLINE_METHODS = [
  'card_machine_delivery', 'delivery_card_machine', 'card_machine',
  'delivery_money', 'money_delivery', 'delivery_cash', 'cash_delivery',
  'cash', 'money', 'pix_delivery', 'delivery_pix', 'payment_on_pickup',
];

export function isMetodoOffline(method: string | null | undefined): boolean {
  const m = (method || '').toLowerCase();
  return OFFLINE_METHODS.includes(m) || m.includes('machine') || m.includes('cash') || m.includes('money') || m.includes('pickup');
}
