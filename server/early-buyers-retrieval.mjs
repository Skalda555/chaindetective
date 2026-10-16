export function candidateKey(chain, hash) {
  return `${chain}:${String(hash ?? '').toLowerCase()}`;
}

export function clusterCandidateBlocks(blocks, maxGap = 12, maxWidth = Number.MAX_SAFE_INTEGER) {
  const sorted = [...new Set(blocks.map(Number).filter(Number.isSafeInteger))].sort((a, b) => a - b);
  const clusters = [];
  for (const block of sorted) {
    const previous = clusters.at(-1);
    if (!previous || block - previous.toBlock > maxGap + 1 || block + 1 - previous.fromBlock > maxWidth) clusters.push({ fromBlock: block, toBlock: block + 1, blocks: [block] });
    else { previous.toBlock = block + 1; previous.blocks.push(block); }
  }
  return clusters;
}

export function indexPoolOutCandidates(logs, swapCandidateHashes, pairMap) {
  const candidates = new Map();
  for (const log of logs) {
    const hash = String(log.transactionHash ?? log.transaction_hash ?? '').toLowerCase();
    if (!swapCandidateHashes.has(hash)) continue;
    const from = `0x${String(log.topics?.[1] ?? log.topic1 ?? '').slice(-40).toLowerCase()}`;
    const pool = pairMap.get(from);
    if (!pool || String(log.address ?? '').toLowerCase() !== String(pool.token.contract).toLowerCase()) continue;
    candidates.set(hash, Number(log.blockNumber ?? log.block_number));
  }
  return candidates;
}

export function retainCandidatePage({ chain, data, candidateHashes, logs, transactions, blocks, seenLogs }) {
  const hashSet = candidateHashes instanceof Set ? candidateHashes : new Set(candidateHashes);
  let retainedLogs = 0; let discardedLogs = 0; let duplicateLogs = 0;
  for (const log of data.logs ?? []) {
    const hash = String(log.transactionHash ?? log.transaction_hash ?? '').toLowerCase();
    if (!hashSet.has(hash)) { discardedLogs += 1; continue; }
    const key = `${chain}:${Number(log.blockNumber ?? log.block_number)}:${Number(log.logIndex ?? log.log_index)}`;
    if (seenLogs.has(key)) { duplicateLogs += 1; continue; }
    seenLogs.add(key); logs.push(log); retainedLogs += 1;
  }
  for (const tx of data.transactions ?? []) {
    const hash = String(tx.hash ?? '').toLowerCase();
    if (hashSet.has(hash)) transactions.set(hash, tx);
  }
  for (const block of data.blocks ?? []) {
    const number = Number(block.number ?? block.block_number);
    if (Number.isSafeInteger(number)) blocks.set(number, block);
  }
  return { retainedLogs, discardedLogs, duplicateLogs };
}
