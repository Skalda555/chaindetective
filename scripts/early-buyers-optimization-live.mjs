import '../server/load-env.mjs';
import { runEarlyBuyersScan } from '../server/early-buyers-engine.mjs';

console.log(`ENVIO_API_TOKEN present: ${Boolean(process.env.ENVIO_API_TOKEN)}`);
const result = await runEarlyBuyersScan({ apiToken: process.env.ENVIO_API_TOKEN, validate: true, writeArtifact: true, excludeTop100: true });
console.log('LIVE_OPTIMIZATION_SUMMARY');
console.log(JSON.stringify({ snapshotAt: result.snapshotAt, windowStart: result.windowStart, windowEnd: result.windowEnd,
  tokens: result.tokens.map(({ symbol, chain, marketCapRank, pools }) => ({ symbol, chain, marketCapRank, pools: pools.map(({ pairAddress }) => pairAddress) })),
  status: result.status ?? null, diagnostics: result.diagnostics, timing: result.timing, dataVolume: result.dataVolume,
  validation: result.validation, thresholds: { 250: result.thresholds?.[250]?.buyCount, 500: result.thresholds?.[500]?.buyCount },
}, null, 2));
