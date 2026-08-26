/**
 * Mint an API key.
 *
 *   API_KEY_PEPPER=... node dist/mint-key.js "Client name" [live|test]
 *
 * Prints the token ONCE (it cannot be recovered) plus the record to add to the
 * seed. Deliberately built from the same module the server verifies with: a
 * separate minting script would be free to drift from the verifier, and the
 * first symptom would be keys that authenticate nowhere.
 */
import { mintApiKey } from '../lib/apiKey.js';
import type { KeyEnvironment } from '../lib/apiKey.js';

const pepper = process.env['API_KEY_PEPPER'] ?? '';
if (pepper === '') {
  console.error('API_KEY_PEPPER is required (same value the server uses)');
  process.exit(1);
}

const name = process.argv[2];
if (name === undefined || name.trim() === '') {
  console.error('usage: mint-key "Client name" [live|test]');
  process.exit(1);
}

const envArg = process.argv[3] ?? 'live';
if (envArg !== 'live' && envArg !== 'test') {
  console.error('environment must be "live" or "test"');
  process.exit(1);
}

const minted = mintApiKey(pepper, envArg as KeyEnvironment);

// The token goes to stdout and the record to stderr, so a caller can capture
// one without the other and never accidentally log the secret next to the row.
process.stderr.write(
  `${JSON.stringify(
    {
      keyId: minted.keyId,
      secretHash: minted.secretHash,
      name,
      status: 'active',
      // Free tier. Keep in sync with the defaults in lib/keyStore.ts, which
      // explain why these numbers are what they are. Raise them in the record
      // by hand for a paying integration.
      quotaPerMinute: 3,
      quotaPerDay: 50,
      maxConcurrent: 1,
    },
    null,
    2,
  )}\n`,
);
process.stderr.write('\nAdd the record above to API_KEYS. The token below is shown ONCE:\n\n');
process.stdout.write(`${minted.token}\n`);
