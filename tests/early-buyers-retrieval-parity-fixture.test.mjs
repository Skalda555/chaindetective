import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const fields = ['verdict', 'reasonCode', 'buyerWallet', 'tokenAmount', 'quoteAmountRaw', 'amountUsd', 'quoteTokenContract', 'priceMethod'];
for (const chain of ['base', 'ethereum']) {
  const bytes = await readFile(new URL(`./fixtures/early-buyers-${chain}-oracle-golden.json.gz`, import.meta.url));
  const fixture = JSON.parse(gunzipSync(bytes));
  assert.equal(fixture.chain, chain);
  assert.ok(fixture.candidates.length > 0, `${chain} fixture contains frozen candidates`);
  const hashes = fixture.candidates.map(({ txHash }) => txHash.toLowerCase());
  assert.equal(new Set(hashes).size, hashes.length, `${chain} candidate hashes are unique`);

  for (const candidate of fixture.candidates) {
    assert.ok(Number.isInteger(candidate.blockNumber), `${chain} ${candidate.txHash} has a frozen block`);
    assert.ok(candidate.old && candidate.new, `${chain} ${candidate.txHash} has both retrieval contexts`);
    assert.equal(candidate.old.blockNumber, candidate.new.blockNumber);
    assert.deepEqual(candidate.old.transaction, candidate.new.transaction, `${chain} ${candidate.txHash} transaction metadata parity`);
    assert.deepEqual(candidate.old.block, candidate.new.block, `${chain} ${candidate.txHash} block metadata parity`);
    assert.deepEqual(candidate.old.logs, candidate.new.logs, `${chain} ${candidate.txHash} resolver log context parity`);
    const oldOutcomes = candidate.outcomes.old.map((item) => Object.fromEntries(fields.map((field) => [field, item[field] ?? null])));
    const newOutcomes = candidate.outcomes.new.map((item) => Object.fromEntries(fields.map((field) => [field, item[field] ?? null])));
    assert.deepEqual(newOutcomes, oldOutcomes, `${chain} ${candidate.txHash} resolver result parity`);
  }
  console.log(`Early Buyers ${chain} oracle golden fixture passed (${fixture.candidates.length} frozen candidates).`);
}
