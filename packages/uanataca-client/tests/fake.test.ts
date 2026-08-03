import { describe, expect, it } from 'vitest';
import {
  type CreateCertificateRequestInput,
  FakeUanatacaClient,
  type NaturalPersonFiles,
  type NaturalPersonKyc,
  UanatacaError,
  isIssued,
  isTerminalStatus,
  mapNaturalPersonToCreateInput,
  needsCustomerUpdate,
} from '../src/index.js';

const files: NaturalPersonFiles = {
  frontIdentification: { name: 'front.jpg', type: 'image/jpeg', base64: 'AAAA' },
  backIdentification: { name: 'back.jpg', type: 'image/jpeg', base64: 'BBBB' },
  selfie: { name: 'selfie.jpg', type: 'image/jpeg', base64: 'CCCC' },
};

const baseKyc: NaturalPersonKyc = {
  identification: '0102030405',
  fingerprintCode: 'A1B2C3',
  names: 'Juan Carlos',
  lastName1: 'Pérez',
  birthDate: '15/05/1990',
  nationality: 'ECUATORIANA',
  sex: 'HOMBRE',
  phoneNumber: '0991234567',
  email: 'juan@example.com',
  province: 'PICHINCHA',
  city: 'QUITO',
  address: 'Av. Amazonas N34-56',
  productUuid: 'prod-natural-1a',
};

function input(
  overrides: Partial<CreateCertificateRequestInput> = {},
): CreateCertificateRequestInput {
  return { ...mapNaturalPersonToCreateInput(baseKyc, files), ...overrides };
}

describe('FakeUanatacaClient', () => {
  it('lista productos y productos del stakeholder (precio de costo)', async () => {
    const c = new FakeUanatacaClient();
    const products = await c.listProducts();
    expect(products.length).toBeGreaterThan(0);
    const sp = await c.listStakeholderProducts('whatever');
    expect(sp[0]?.productUuid).toBe(products[0]?.uuid);
    expect(sp[0]?.price).toBe(products[0]?.price);
  });

  it('crea una solicitud en estado NEW y descuenta el saldo', async () => {
    const c = new FakeUanatacaClient({ initialBalance: 100 });
    const res = await c.createCertificateRequest(input());
    expect(res.uuid).toMatch(/^fake-req-\d{4}$/);
    expect(res.locationMissing).toBe(false);
    expect(res.location).toContain(res.uuid ?? 'x');
    expect(await c.getBalance()).toBe(70); // 100 - 30
    const found = await c.listCertificateRequests({ uuid: res.uuid ?? '' });
    expect(found[0]?.status).toBe('NEW');
  });

  it('respeta idempotencyKey: dos creaciones devuelven el mismo uuid y un solo cobro', async () => {
    const c = new FakeUanatacaClient({ initialBalance: 100 });
    const a = await c.createCertificateRequest(input({ idempotencyKey: 'k1' }));
    const b = await c.createCertificateRequest(input({ idempotencyKey: 'k1' }));
    expect(a.uuid).toBe(b.uuid);
    expect(await c.getBalance()).toBe(70);
    expect(await c.listCertificateRequests()).toHaveLength(1);
  });

  it('rechaza productUuid inexistente', async () => {
    const c = new FakeUanatacaClient();
    await expect(c.createCertificateRequest(input({ productUuid: 'nope' }))).rejects.toBeInstanceOf(
      UanatacaError,
    );
  });

  it('rechaza por saldo insuficiente', async () => {
    const c = new FakeUanatacaClient({ initialBalance: 5 });
    await expect(c.createCertificateRequest(input())).rejects.toMatchObject({ status: 400 });
  });

  it('progresa NEW → IN_VALIDATION → ISSUED y filtra por estado', async () => {
    const c = new FakeUanatacaClient();
    const { uuid } = await c.createCertificateRequest(input());
    const id = uuid ?? '';
    c.setStatus(id, 'IN_VALIDATION');
    expect((await c.listCertificateRequests({ status: 'IN_VALIDATION' }))[0]?.uuid).toBe(id);
    c.setStatus(id, 'ISSUED');
    const issued = (await c.listCertificateRequests({ uuid: id }))[0];
    expect(issued).toBeDefined();
    expect(isIssued(issued?.status ?? '')).toBe(true);
    expect(isTerminalStatus(issued?.status ?? '')).toBe(true);
    expect(issued?.approvedDate).not.toBeNull();
  });

  it('setStatus de un uuid inexistente lanza 404', () => {
    const c = new FakeUanatacaClient();
    expect(() => c.setStatus('nope', 'ISSUED')).toThrow(UanatacaError);
  });

  it('busca por identificación (recuperación tipo reconciliación)', async () => {
    const c = new FakeUanatacaClient();
    await c.createCertificateRequest(input());
    const byId = await c.listCertificateRequests({ q: '0102030405' });
    expect(byId).toHaveLength(1);
  });

  it('helpers de estado: UPDATE_REQUESTED pide corrección y no es terminal', () => {
    expect(needsCustomerUpdate('UPDATE_REQUESTED')).toBe(true);
    expect(isTerminalStatus('UPDATE_REQUESTED')).toBe(false);
    expect(isTerminalStatus('REJECTED')).toBe(true);
  });
});
