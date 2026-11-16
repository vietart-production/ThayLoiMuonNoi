/*
 * npm run selftest  (from the repo root)
 *
 * Checks toE164 in assets/firebase-client.js against the shapes people actually type.
 * That file imports Firebase from a CDN, so the function is lifted out by source rather
 * than imported — this tests the code that ships.
 *
 * It matters because the failure is silent and total: a shape the normaliser rejects is
 * simply a person who cannot log in, with no error anywhere but their own screen.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync('assets/firebase-client.js', 'utf8');
const start = src.indexOf('function toE164(');
assert.ok(start > 0, 'toE164 not found in assets/firebase-client.js');
const end = src.indexOf('\n}', start) + 2;

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end) + '\nglobalThis.fn = toE164;', sandbox);
const toE164 = sandbox.fn;

const accepted = {
  '0901234567': '+84901234567',
  '0901 234 567': '+84901234567',
  '090.123.4567': '+84901234567',
  '090-123-4567': '+84901234567',
  '(090) 123 4567': '+84901234567',
  '  0901234567  ': '+84901234567',
  '+84901234567': '+84901234567',
  '+84 901 234 567': '+84901234567',
  '84901234567': '+84901234567',
  '+840901234567': '+84901234567', // trunk 0 left in after the country code
  '0084901234567': '+84901234567', // 00 as the international prefix
  '901234567': '+84901234567',     // no trunk 0 at all
  '02838221234': '+842838221234',  // landline: 10 digits after the 0
  // Ambiguous: could read as +84 followed by seven digits, which is not a number. The
  // optional country-code group has to backtrack and treat it as local 0849123456.
  '849123456': '+84849123456',
};
for (const [input, expected] of Object.entries(accepted)) {
  assert.equal(toE164(input), expected, `${JSON.stringify(input)} should normalise to ${expected}`);
}

const rejected = ['', '   ', '090123', 'abc', '09012345678901', '+1 202 555 0147', '+84', '0'];
for (const input of rejected) {
  assert.equal(toE164(input), null, `${JSON.stringify(input)} should be rejected, got ${toE164(input)}`);
}

// Whatever comes out must be something Firebase will accept as a phone number.
for (const expected of Object.values(accepted)) {
  assert.ok(/^\+84\d{9,10}$/.test(expected), `${expected} is not E.164`);
}

console.log(`toE164: ${Object.keys(accepted).length} accepted shapes normalise to E.164, ${rejected.length} rejected`);
console.log('\nALL PHONE CHECKS PASSED');
