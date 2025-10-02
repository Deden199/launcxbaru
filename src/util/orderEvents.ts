import { EventEmitter } from 'node:events';

type OrderLoanSettledEvent = {
  orderId: string;
  previousStatus: string;
  adminId?: string;
  markedAt: string;
  note?: string;
};

type OrderLoanSettlementRevertedEvent = {
  orderId: string;
  previousStatus: string;
  restoredStatus: string;
  adminId?: string;
  revertedAt: string;
  note?: string;
  revertOf?: string;
};

type OrderEventPayloads = {
  'order.loan_settled': OrderLoanSettledEvent;
  'order.loan_settlement_reverted': OrderLoanSettlementRevertedEvent;
};

const emitter = new EventEmitter();

export function emitOrderEvent<K extends keyof OrderEventPayloads>(
  event: K,
  payload: OrderEventPayloads[K],
) {
  emitter.emit(event, payload);
}

export function onOrderEvent<K extends keyof OrderEventPayloads>(
  event: K,
  listener: (payload: OrderEventPayloads[K]) => void,
) {
  emitter.on(event, listener);
}

export function onceOrderEvent<K extends keyof OrderEventPayloads>(
  event: K,
  listener: (payload: OrderEventPayloads[K]) => void,
) {
  emitter.once(event, listener);
}

export function removeOrderEventListener<K extends keyof OrderEventPayloads>(
  event: K,
  listener: (payload: OrderEventPayloads[K]) => void,
) {
  emitter.off(event, listener);
}
