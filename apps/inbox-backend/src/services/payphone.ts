/**
 * Abstracción de la pasarela PayPhone (botón de pago / Cajita de Pagos).
 * Comisión real verificada: 5% + IVA(15%) = 5.75% efectivo (payphone.app).
 *
 * AISLADO: interfaz + FakePayphoneClient (sin red). El adapter HTTP real
 * (apps/inbox-backend/src/services/payphone-http.ts) se implementa con las
 * credenciales del comercio (token + storeId) en F9.2.
 */

export interface PayphonePrepareInput {
  /** monto total a cobrar en centavos (PayPhone usa enteros) */
  amount: number;
  /** IVA en centavos (parte del amount) */
  tax: number;
  /** referencia única del comercio (idempotencia) */
  clientTransactionId: string;
  reference: string;
}

export interface PayphonePrepareResult {
  paymentId: string;
  /** URL a la que se redirige al cliente para pagar */
  paymentUrl: string;
}

export interface PayphoneConfirmResult {
  approved: boolean;
  authorizationCode: string | null;
  transactionReference: string | null;
  message: string;
}

export interface PayphoneClient {
  prepare(input: PayphonePrepareInput): Promise<PayphonePrepareResult>;
  confirm(paymentId: string, clientTransactionId: string): Promise<PayphoneConfirmResult>;
}

/** Comisión efectiva PayPhone: rate + IVA sobre la comisión. */
export function payphoneCommissionCents(amountCents: number, rate = 0.05, iva = 0.15): number {
  return Math.round(amountCents * rate * (1 + iva));
}

/** Fake determinista: prepare devuelve un id; confirm aprueba salvo que se configure. */
export class FakePayphoneClient implements PayphoneClient {
  private seq = 0;
  private readonly prepared = new Map<string, PayphonePrepareInput>();

  constructor(private readonly opts: { approve?: boolean } = {}) {}

  async prepare(input: PayphonePrepareInput): Promise<PayphonePrepareResult> {
    this.seq += 1;
    const paymentId = `PP-${this.seq}-${input.clientTransactionId}`;
    this.prepared.set(paymentId, input);
    return { paymentId, paymentUrl: `https://fake.payphone/pay/${paymentId}` };
  }

  async confirm(
    paymentId: string,
    clientTransactionId: string,
  ): Promise<PayphoneConfirmResult> {
    const prep = this.prepared.get(paymentId);
    const approved = (this.opts.approve ?? true) && prep?.clientTransactionId === clientTransactionId;
    return {
      approved,
      authorizationCode: approved ? `AUTH${this.seq}` : null,
      transactionReference: approved ? `TX${this.seq}` : null,
      message: approved ? 'Approved' : 'Declined',
    };
  }
}
