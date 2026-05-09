import type { OcspStatus } from './result';

export async function checkOcsp(): Promise<OcspStatus> {
  return { status: 'not_checked', source: 'none' };
}
