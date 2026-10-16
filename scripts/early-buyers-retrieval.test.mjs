import assert from 'node:assert/strict';
import { candidateKey, clusterCandidateBlocks, indexPoolOutCandidates, retainCandidatePage } from '../server/early-buyers-retrieval.mjs';

const a = `0x${'a'.repeat(64)}`; const b = `0x${'b'.repeat(64)}`;
assert.equal(candidateKey('base', a.toUpperCase()), `base:${a}`);
assert.deepEqual(clusterCandidateBlocks([100, 101, 110, 123, 130], 2), [
  { fromBlock: 100, toBlock: 102, blocks: [100, 101] },
  { fromBlock: 110, toBlock: 111, blocks: [110] },
  { fromBlock: 123, toBlock: 124, blocks: [123] },
  { fromBlock: 130, toBlock: 131, blocks: [130] },
]);
assert.deepEqual(clusterCandidateBlocks([1, 500, 16384, 16385, 20000], 16384, 16384).map(({ fromBlock, toBlock }) => [fromBlock, toBlock]),
  [[1, 16385], [16385, 20001]], 'candidate context clusters have a hard maximum width');
const poolA = `0x${'1'.repeat(40)}`; const tokenA = `0x${'2'.repeat(40)}`;
const pairMap = new Map([[poolA, { token: { contract: tokenA }, pair: { pairAddress: poolA } }]]);
assert.deepEqual(indexPoolOutCandidates([
  { transactionHash: a, blockNumber: 42, address: tokenA, topics: ['', `0x${'0'.repeat(24)}${poolA.slice(2)}`] },
  { transactionHash: a, blockNumber: 42, address: tokenA, topics: ['', `0x${'0'.repeat(24)}${poolA.slice(2)}`] },
  { transactionHash: b, blockNumber: 42, address: tokenA, topics: ['', `0x${'0'.repeat(24)}${poolA.slice(2)}`] },
], new Set([a]), pairMap), new Map([[a, 42]]), 'same candidate tx across pools is indexed once and unrelated hashes are ignored');

const candidateHashes = new Set([a]); const retained = []; const transactions = new Map(); const blocks = new Map(); const seen = new Set();
const duplicate = { transactionHash: a, blockNumber: 7, logIndex: 5, address: 'pool' };
const page = { logs: [duplicate, { transactionHash: b, blockNumber: 7, logIndex: 6 }, duplicate],
  transactions: [{ hash: a }, { hash: b }], blocks: [{ number: 7 }, { number: 8 }] };
assert.deepEqual(retainCandidatePage({ chain: 'base', data: page, candidateHashes, logs: retained, transactions, blocks, seenLogs: seen }),
  { retainedLogs: 1, discardedLogs: 1, duplicateLogs: 1 });
assert.deepEqual(retained, [duplicate], 'only candidate transaction context remains in memory');
assert.deepEqual([...transactions.keys()], [a], 'unrelated transactions are discarded');
assert.deepEqual([...blocks.keys()], [7, 8]);
console.log('early-buyers retrieval tests passed');
