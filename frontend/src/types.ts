export type ViewType = 'landing' | 'home' | 'deposit' | 'draw' | 'result' | 'claim' | 'privacy' | 'admin';

export interface TxState {
  status: 'idle' | 'preparing' | 'signing' | 'submitting' | 'confirming' | 'success' | 'rejected' | 'failed';
  step: number;
}
