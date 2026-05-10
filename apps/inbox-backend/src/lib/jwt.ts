import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'firmar-ec-inbox';
const ALG = 'HS256';
const DEFAULT_TTL_SEC = 15 * 60;

export interface InboxJwtPayload {
  otpHash: string;
}

function keyFromSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueJwt(
  otpHash: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SEC,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setSubject(otpHash)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(keyFromSecret(secret));
}

export async function verifyJwt(
  token: string,
  secret: string,
): Promise<InboxJwtPayload> {
  const { payload } = await jwtVerify(token, keyFromSecret(secret), {
    issuer: ISSUER,
    algorithms: [ALG],
  });
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('jwt missing sub');
  }
  return { otpHash: payload.sub };
}
