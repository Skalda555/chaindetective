import '../server/load-env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIgnoredWalletAddress } from '../dist/data.js';
import { confirmedBuyerMetrics } from './onchain-discovery-core.mjs';
import { runEarlyBuyersScan } from '../server/early-buyers-engine.mjs';

const replayPath = process.argv.find((arg) => arg.startsWith('--replay-artifact='))?.slice('--replay-artifact='.length);
const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);
if (!replayPath || !outputPath) throw new Error('Usage: node scripts/onchain-discovery-longitudinal-resolver.mjs --replay-artifact=<path> --output=<path>');
const replay = JSON.parse(await readFile(replayPath, 'utf8'));
if (!process.env.ENVIO_API_TOKEN) throw new Error('ENVIO_API_TOKEN is missing.');

function readWalletSets() {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../.data/chaindetective.sqlite');
  let db;
  try { db = new DatabaseSync(path, { readOnly: true }); } catch { return { smart: new Set(), historical: new Set() }; }
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const smart = tables.has('smart_wallets') ? db.prepare("SELECT address FROM smart_wallets WHERE status IN ('candidate','reviewed')").all()
      .map((row) => String(row.address).toLowerCase()).filter((address) => !isIgnoredWalletAddress(address)) : [];
    const historical = tables.has('early_buyer_wallet_tokens') && tables.has('early_buyer_snapshots')
      ? db.prepare(`SELECT DISTINCT LOWER(w.wallet_address) AS wallet FROM early_buyer_wallet_tokens w JOIN early_buyer_snapshots s ON s.id=w.snapshot_id
        WHERE w.threshold_250=1 AND s.status IN ('complete','complete_with_warnings')`).all()
        .map((row) => row.wallet).filter((address) => !isIgnoredWalletAddress(address)) : [];
    return { smart: new Set(smart), historical: new Set(historical) };
  } finally { db.close(); }
}

const snapshot = await runEarlyBuyersScan({ apiToken: process.env.ENVIO_API_TOKEN, captureOracle: true, writeArtifact: false, excludeTop100: false });
const oracle = snapshot.oracleParityFixture;
const txTimestamps = new Map();
for (const [chain, group] of Object.entries(oracle.resolverInput ?? {})) for (const candidate of group.candidates ?? []) {
  if (candidate.block?.timestamp) txTimestamps.set(`${chain}:${String(candidate.txHash).toLowerCase()}`, Number(candidate.block.timestamp));
}
const wallets = readWalletSets();
const metrics = confirmedBuyerMetrics({ outcomes: oracle.outcomes, txTimestamps, candidates: replay.tokens,
  smartWallets: wallets.smart, historicalHits: wallets.historical, days: 14 });
const perToken = replay.tokens.map((token) => {
  const key = `${token.chain}:${token.contract.toLowerCase()}`; const row = metrics.get(key);
  const outcomes = oracle.outcomes.filter((item) => item.chain === token.chain && item.tokenContract?.toLowerCase() === token.contract.toLowerCase());
  const counts = { CONFIRMED: 0, UNCERTAIN: 0, REJECTED: 0 };
  for (const item of outcomes) if (counts[item.verdict] !== undefined) counts[item.verdict] += 1;
  return { chain: token.chain, contract: token.contract.toLowerCase(), outcomes: counts,
    uniqueBuyers250: row?.confirmedBuys250.uniqueConfirmedWallets ?? 0,
    uniqueBuyers500: row?.confirmedBuys500.uniqueConfirmedWallets ?? 0,
    smartWalletOverlap250: row?.confirmedBuys250.knownSmartWalletCount ?? 0,
    smartWalletOverlap500: row?.confirmedBuys500.knownSmartWalletCount ?? 0,
    historicalHitOverlap250: row?.confirmedBuys250.historicalHitWalletCount ?? 0,
    historicalHitOverlap500: row?.confirmedBuys500.historicalHitWalletCount ?? 0,
  };
});
await writeFile(outputPath, JSON.stringify({ snapshotAt: snapshot.snapshotAt, perToken,
  diagnostics: { hypersyncQueries: snapshot.diagnostics.hypersyncQueries, responseBytes: snapshot.diagnostics.responseBytes,
    memory: snapshot.diagnostics.memory } }, null, 2));
console.log(`Canonical pilot resolver completed for ${perToken.length} tokens; result written to ${outputPath}.`);
