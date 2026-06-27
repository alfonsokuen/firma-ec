import { describe, expect, it } from 'vitest';
import {
  type NaturalPersonFiles,
  type NaturalPersonKyc,
  UanatacaError,
  mapNaturalPersonToCreateInput,
} from '../src/index.js';

const files: NaturalPersonFiles = {
  frontIdentification: { name: 'front.jpg', type: 'image/jpeg', base64: 'AAAA' },
  backIdentification: { name: 'back.jpg', type: 'image/jpeg', base64: 'BBBB' },
  selfie: { name: 'selfie.jpg', type: 'image/jpeg', base64: 'CCCC' },
};

function kyc(overrides: Partial<NaturalPersonKyc> = {}): NaturalPersonKyc {
  return {
    identification: '0102030405',
    fingerprintCode: 'A1B2C3',
    names: '  Juan Carlos ',
    lastName1: ' Pérez ',
    lastName2: ' López ',
    birthDate: '15/05/1990',
    nationality: 'ECUATORIANA',
    sex: 'HOMBRE',
    phoneNumber: '0991234567',
    email: '  juan@example.com ',
    province: 'PICHINCHA',
    city: 'QUITO',
    address: 'Av. Amazonas N34-56',
    productUuid: 'prod-natural-1a',
    ...overrides,
  };
}

describe('mapNaturalPersonToCreateInput', () => {
  it('mapea persona natural válida y normaliza espacios', () => {
    const input = mapNaturalPersonToCreateInput(kyc(), files, 'k1');
    expect(input.identificationType).toBe('CÉDULA');
    expect(input.names).toBe('Juan Carlos');
    expect(input.lastName1).toBe('Pérez');
    expect(input.lastName2).toBe('López');
    expect(input.email).toBe('juan@example.com');
    expect(input.frontIdentification.base64).toBe('AAAA');
    expect(input.idempotencyKey).toBe('k1');
  });

  it('rechaza cédula con formato inválido', () => {
    expect(() => mapNaturalPersonToCreateInput(kyc({ identification: '123' }), files)).toThrow(
      UanatacaError,
    );
  });

  it('rechaza email mal formado', () => {
    expect(() => mapNaturalPersonToCreateInput(kyc({ email: 'no-arroba' }), files)).toThrow(
      UanatacaError,
    );
  });

  it('rechaza teléfono que no es de 10 dígitos', () => {
    expect(() => mapNaturalPersonToCreateInput(kyc({ phoneNumber: '099' }), files)).toThrow(
      UanatacaError,
    );
  });

  it('rechaza fecha de nacimiento fuera de dd/MM/yyyy', () => {
    expect(() => mapNaturalPersonToCreateInput(kyc({ birthDate: '1990-05-15' }), files)).toThrow(
      UanatacaError,
    );
  });

  it('rechaza un archivo vacío', () => {
    const bad: NaturalPersonFiles = {
      ...files,
      selfie: { name: 's', type: 'image/jpeg', base64: '' },
    };
    expect(() => mapNaturalPersonToCreateInput(kyc(), bad)).toThrow(UanatacaError);
  });

  it('rechaza campos de domicilio vacíos', () => {
    expect(() => mapNaturalPersonToCreateInput(kyc({ city: '   ' }), files)).toThrow(UanatacaError);
  });

  it('rechaza un archivo que no es base64 válido', () => {
    const bad: NaturalPersonFiles = {
      ...files,
      selfie: { name: 's.jpg', type: 'image/jpeg', base64: 'no es base64!!' },
    };
    expect(() => mapNaturalPersonToCreateInput(kyc(), bad)).toThrow(UanatacaError);
  });
});
