import '../server/load-env.mjs';
import { readFile } from 'node:fs/promises';
import { swapEventFor } from './trending-early-buyers-decode.mjs';
import { toEventSelector } from 'viem';

const token = process.env.ENVIO_API_TOKEN;
if (!token) {
  console.log('ENVIO_API_TOKEN present: false');
  process.exitCode = 2;
} else {
  console.log('ENVIO_API_TOKEN present: true');
  const artifact = JSON.parse(await readFile(new URL('../tmp/trending-early-buyers-hypersync-poc.json', import.meta.url), 'utf8'));
  const trades = artifact.trades.filter((item) => item.chain === 'ethereum' && item.txHash && Number.isInteger(item.blockNumber));
  const pools = new Map(artifact.tokens.flatMap((item) => item.pools.map((pool) => [String(pool.pairAddress).toLowerCase(), pool])));
  const samples = [];
  const seen = new Set();
  for (const trade of trades) {
    const hash = String(trade.txHash).toLowerCase();
    if (seen.has(hash)) continue;
    seen.add(hash);
    const pool = pools.get(String(trade.poolAddress).toLowerCase());
    const swap = swapEventFor(pool?.decoder);
    if (!pool || !swap) continue;
    samples.push({ hash, block: trade.blockNumber, pool: String(trade.poolAddress).toLowerCase(), topic: toEventSelector(swap.abi).toLowerCase() });
    if (samples.length === 5) break;
  }
  if (samples.length !== 5) throw new Error(`C1 probe needs five known transaction hashes; found ${samples.length}.`);

  const results = [];
  for (const sample of samples) {
    const query = {
      from_block: sample.block,
      to_block: sample.block + 1,
      transactions: [{ hash: [sample.hash] }],
      logs: [{}],
      field_selection: {
        block: ['number', 'timestamp', 'hash'],
        transaction: ['hash', 'from', 'to', 'block_number', 'block_hash', 'status', 'type'],
        log: ['address', 'topic0', 'topic1', 'topic2', 'topic3', 'data', 'transaction_hash', 'block_number', 'transaction_index', 'log_index'],
      },
      join_mode: 'JoinAll',
      max_num_transactions: 1_000,
      max_num_logs: 1_000,
      max_num_blocks: 1,
    };
    const response = await fetch('https://eth.hypersync.xyz/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    if (!response.ok) {
      results.push({ status: response.status, error: body.slice(0, 300) });
      continue;
    }
    const json = JSON.parse(body);
    const batches = Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
    const transactions = batches.flatMap((batch) => batch.transactions ?? []);
    const logs = batches.flatMap((batch) => batch.logs ?? []);
    const blocks = batches.flatMap((batch) => batch.blocks ?? []);
    const transactionHashes = new Set(transactions.map((item) => String(item.hash ?? '').toLowerCase()));
    const logHashes = new Set(logs.map((item) => String(item.transaction_hash ?? item.transactionHash ?? '').toLowerCase()));
    results.push({
      status: response.status,
      returnedTransactions: transactions.length,
      targetTransactionReturned: transactionHashes.has(sample.hash),
      exactTransactionSet: transactionHashes.size === 1 && transactionHashes.has(sample.hash),
      logs: logs.length,
      targetTransactionHasLogs: logHashes.has(sample.hash),
      unrelatedTransactionLogs: [...logHashes].filter((hash) => hash !== sample.hash).length,
      blocks: blocks.length,
      targetBlockTimestampReturned: blocks.some((block) => Number(block.number) === sample.block && Number(block.timestamp) > 0),
      responseBytes: Buffer.byteLength(body),
      nextBlock: json.next_block,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  const c1Supported = results.length === 5 && results.every((item) => item.exactTransactionSet && item.targetTransactionHasLogs
    && item.unrelatedTransactionLogs === 0 && item.targetBlockTimestampReturned);
  console.log(JSON.stringify({ c1TransactionHashWithJoinAllSupported: c1Supported, testedHashes: samples.length, results }));

  const c2Results = [];
  for (const sample of samples) {
    const query = {
      from_block: sample.block,
      to_block: sample.block + 1,
      logs: [{ address: [sample.pool], topics: [[sample.topic]] }],
      field_selection: {
        block: ['number', 'timestamp', 'hash'],
        transaction: ['hash', 'from', 'to', 'block_number', 'block_hash', 'status', 'type'],
        log: ['address', 'topic0', 'topic1', 'topic2', 'topic3', 'data', 'transaction_hash', 'block_number', 'transaction_index', 'log_index'],
      },
      join_mode: 'JoinAll',
      max_num_transactions: 10_000,
      max_num_logs: 10_000,
      max_num_blocks: 1,
    };
    const response = await fetch('https://eth.hypersync.xyz/query', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    if (!response.ok) {
      c2Results.push({ status: response.status, error: body.slice(0, 300) });
      continue;
    }
    const json = JSON.parse(body);
    const batches = Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
    const transactions = batches.flatMap((batch) => batch.transactions ?? []);
    const logs = batches.flatMap((batch) => batch.logs ?? []);
    const transactionHashes = new Set(transactions.map((item) => String(item.hash ?? '').toLowerCase()));
    const candidateLogs = logs.filter((item) => String(item.transaction_hash ?? item.transactionHash ?? '').toLowerCase() === sample.hash);
    c2Results.push({
      status: response.status,
      returnedTransactions: transactions.length,
      candidateTransactionReturned: transactionHashes.has(sample.hash),
      candidateLogs: candidateLogs.length,
      candidatePoolSwapRetained: candidateLogs.some((log) => String(log.address ?? '').toLowerCase() === sample.pool
        && String(log.topic0 ?? log.topics?.[0] ?? '').toLowerCase() === sample.topic),
      unrelatedTransactionsInJoinedPage: [...new Set(logs.map((item) => String(item.transaction_hash ?? item.transactionHash ?? '').toLowerCase()))]
        .filter((hash) => hash && hash !== sample.hash).length,
      joinedLogs: logs.length,
      responseBytes: Buffer.byteLength(body),
      nextBlock: json.next_block,
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  const c2Supported = c2Results.length === 5 && c2Results.every((item) => item.candidateTransactionReturned && item.candidateLogs > 0 && item.candidatePoolSwapRetained);
  console.log(JSON.stringify({ c2PoolSwapJoinAllProvidesCandidateContext: c2Supported, testedCandidates: samples.length, results: c2Results }));
  if (!c1Supported && !c2Supported) process.exitCode = 1;
}
