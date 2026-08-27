/**
 * Mint an API key.
 *
 *   API_KEY_PEPPER=... node dist/mint-key.js "Client name" [live|test] [trial|paid] [N]
 *
 * La API alojada es de pago; lo gratuito es el software bajo AGPL, corriendo en
 * la infraestructura de quien lo use. Por eso el plan por defecto es `trial` y
 * SIEMPRE lleva fecha de fin.
 *
 *   trial [N]  N = dias de vigencia (por defecto 30). Cuota de prueba.
 *   paid  N    N = volumen diario contratado. OBLIGATORIO — sin default, para
 *              que nadie emita por descuido una clave sin caducidad con la
 *              cuota de una prueba.
 *
 * Prints the token ONCE (it cannot be recovered) plus the record to add to the
 * seed. Deliberately built from the same module the server verifies with: a
 * separate minting script would be free to drift from the verifier, and the
 * first symptom would be keys that authenticate nowhere.
 */
import { mintApiKey } from '../lib/apiKey.js';
import type { KeyEnvironment } from '../lib/apiKey.js';
import { buildKeyRecord, TRIAL_DAYS, type KeyPlan } from '../lib/keyPlans.js';

const USAGE = 'usage: mint-key "Client name" [live|test] [trial|paid] [N]';

const pepper = process.env['API_KEY_PEPPER'] ?? '';
if (pepper === '') {
  console.error('API_KEY_PEPPER is required (same value the server uses)');
  process.exit(1);
}

const name = process.argv[2];
if (name === undefined || name.trim() === '') {
  console.error(USAGE);
  process.exit(1);
}

const envArg = process.argv[3] ?? 'live';
if (envArg !== 'live' && envArg !== 'test') {
  console.error('environment must be "live" or "test"');
  process.exit(1);
}

const planArg = process.argv[4] ?? 'trial';
if (planArg !== 'trial' && planArg !== 'paid') {
  console.error('plan must be "trial" or "paid"');
  process.exit(1);
}

const numberArg = process.argv[5];
let plan: KeyPlan;
if (planArg === 'trial') {
  plan = { kind: 'trial', days: numberArg === undefined ? TRIAL_DAYS : Number(numberArg) };
} else {
  if (numberArg === undefined) {
    console.error('a paid key must declare its daily volume: mint-key "Name" live paid <N>');
    process.exit(1);
  }
  plan = { kind: 'paid', quotaPerDay: Number(numberArg) };
}

const minted = mintApiKey(pepper, envArg as KeyEnvironment);

let record;
try {
  record = buildKeyRecord(
    { keyId: minted.keyId, secretHash: minted.secretHash, name, now: Date.now() },
    plan,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// The token goes to stdout and the record to stderr, so a caller can capture
// one without the other and never accidentally log the secret next to the row.
process.stderr.write(`${JSON.stringify(record, null, 2)}\n`);
process.stderr.write(
  record.expiresAt === undefined
    ? '\nClave de PAGO, sin caducidad. Se revoca con "status": "revoked".\n'
    : `\nClave de PRUEBA. Caduca el ${record.expiresAt} y deja de autenticar sola.\n`,
);
process.stderr.write('\nAdd the record above to API_KEYS. The token below is shown ONCE:\n\n');
process.stdout.write(`${minted.token}\n`);
