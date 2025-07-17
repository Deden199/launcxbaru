export const CALLBACK_ALLOWED_STATUSES = ['PAID', 'DONE', 'SETTLED', 'SUCCESS'];

export function isCallbackStatusAllowed(status: string): boolean {
  return CALLBACK_ALLOWED_STATUSES.includes(status);
}