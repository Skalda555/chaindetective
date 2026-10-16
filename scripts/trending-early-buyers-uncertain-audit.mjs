import { readFile, writeFile } from 'node:fs/promises';

const inputPath = process.argv.find((arg) => arg.startsWith('--input='))?.split('=').slice(1).join('=')
  ?? 'tmp/trending-early-buyers-hypersync-poc.json';
const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.split('=').slice(1).join('=')
  ?? 'tmp/trending-early-buyers-uncertain-review.json';
const data = JSON.parse(await readFile(inputPath, 'utf8'));
const routers = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
  '0xe592427a0aece92de3edee1f18e0157c05861564',
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b',
]);
const api = 'https://eth.blockscout.com/api/v2';

function shuffled(values, seed) {
  const items = [...values];
  let state = seed >>> 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

function uniqueTransactions(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row.txHash || seen.has(row.txHash)) return false;
    seen.add(row.txHash);
    return true;
  });
}

async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 4) throw new Error(`Blockscout HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`Blockscout HTTP ${response.status}`);
    return response.json();
  }
  throw new Error('Blockscout retries exhausted');
}

async function getTransfers(txHash) {
  const url = new URL(`${api}/transactions/${txHash}/token-transfers`);
  url.searchParams.set('type', 'ERC-20');
  const transfers = [];
  for (let page = 0; page < 10; page += 1) {
    const result = await getJson(url.toString());
    transfers.push(...(result.items ?? []));
    if (!result.next_page_params) break;
    for (const [key, value] of Object.entries(result.next_page_params)) url.searchParams.set(key, String(value));
  }
  return transfers;
}

const uncertain = uniqueTransactions(data.diagnostics.uncertainCandidates ?? []);
const random50 = shuffled(uncertain, 0x43484149).slice(0, Math.min(50, uncertain.length));
const topReasons = Object.entries(data.diagnostics.uncertainReasons ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => reason);
const categorySamples = Object.fromEntries(topReasons.map((reason, index) => [reason,
  shuffled(uncertain.filter((row) => row.reasonCode === reason), 0x4541524c + index).slice(0, 10)]));
const selectedByHash = new Map();
for (const row of [...random50, ...Object.values(categorySamples).flat()]) {
  const existing = selectedByHash.get(row.txHash) ?? { row, random50: false, categories: [] };
  existing.random50 ||= random50.some((item) => item.txHash === row.txHash);
  if (topReasons.includes(row.reasonCode) && categorySamples[row.reasonCode]?.some((item) => item.txHash === row.txHash)) existing.categories.push(row.reasonCode);
  selectedByHash.set(row.txHash, existing);
}
const selected = [...selectedByHash.values()];
let nextIndex = 0;
const reviewed = new Array(selected.length);
const worker = async () => {
  while (true) {
    const index = nextIndex++;
    if (index >= selected.length) return;
    const { row, random50, categories } = selected[index];
    try {
      const [tx, transfers] = await Promise.all([
        getJson(`${api}/transactions/${row.txHash}`),
        getTransfers(row.txHash),
      ]);
      const targets = new Set((row.recipients ?? []).map((item) => item.address));
      const targetAddress = String(row.tokenContract ?? '').toLowerCase();
      const tokenTransfers = transfers.filter((transfer) => String(transfer.token?.address_hash ?? transfer.token?.address ?? '').toLowerCase() === targetAddress);
      const sourcePoolTargetOut = tokenTransfers.filter((transfer) => String(transfer.from?.hash ?? '').toLowerCase() === String(row.poolAddress ?? '').toLowerCase())
        .reduce((sum, transfer) => sum + BigInt(transfer.total?.value ?? 0), 0n);
      const recipientEvidence = [...targets].map((address) => {
        const matching = tokenTransfers.filter((transfer) => String(transfer.to?.hash ?? '').toLowerCase() === address);
        return { address, isContract: matching.length ? matching.every((transfer) => transfer.to?.is_contract === true) ? true
          : matching.every((transfer) => transfer.to?.is_contract === false) ? false : null : null,
          totalReceivedRaw: matching.reduce((sum, transfer) => sum + BigInt(transfer.total?.value ?? 0), 0n).toString() };
      });
      const from = String(tx.from?.hash ?? '').toLowerCase();
      const toMetadata = [tx.to?.name, ...(tx.to?.metadata?.tags ?? []).map((tag) => `${tag.name} ${tag.slug}`)].filter(Boolean).join(' ').toLowerCase();
      const hasEndpoint = /entrypoint|account abstraction|bundler/.test(toMetadata);
      const aggregatorEvidence = /1inch|paraswap|zero.?x|odos|cow.?swap|kyber|aggregator|universal router/.test(toMetadata);
      const fromContract = tx.from?.is_contract;
      const terminalAddresses = recipientEvidence.filter((item) => BigInt(item.totalReceivedRaw) > 0n).map((item) => item.address);
      const uniqueTerminal = terminalAddresses.length === 1 ? terminalAddresses[0] : null;
      reviewed[index] = { txHash: row.txHash, reasonCode: row.reasonCode, token: row.token, tokenContract: row.tokenContract,
        candidatePool: row.poolAddress, txFrom: from, txFromIsContract: fromContract ?? null, txTo: String(tx.to?.hash ?? '').toLowerCase(),
        txToName: tx.to?.name ?? null, method: tx.method ?? null, status: tx.status ?? null, timestamp: tx.timestamp ?? null,
        knownRouterTxFrom: routers.has(from), aggregatorEvidence, smartAccountOrBundlerEvidence: hasEndpoint || fromContract === true,
        txFromMatchesUniqueTerminalRecipient: Boolean(uniqueTerminal && uniqueTerminal === from),
        recipientEvidence, sourcePoolTargetOutRaw: sourcePoolTargetOut.toString(),
        sourcePoolOutMatchesHyperSync: sourcePoolTargetOut > 0n && sourcePoolTargetOut === BigInt(row.targetOut ?? 0),
        actualBuy: sourcePoolTargetOut > 0n && terminalAddresses.length > 0 && String(tx.status ?? '').toLowerCase() === 'ok',
        actualWallet: uniqueTerminal && recipientEvidence.find((item) => item.address === uniqueTerminal)?.isContract === false ? uniqueTerminal
          : uniqueTerminal === from ? from : null,
        oldClassifierFailure: row.reasonCode, safeToAutomate: Boolean(uniqueTerminal && (uniqueTerminal === from
          || recipientEvidence.find((item) => item.address === uniqueTerminal)?.isContract === false)),
        random50, topCategorySamples: [...new Set(categories)],
        explorerTransferCount: transfers.length };
    } catch (error) {
      reviewed[index] = { txHash: row.txHash, reasonCode: row.reasonCode, token: row.token, txFrom: row.txFrom,
        recipientEvidence: row.recipients, random50, topCategorySamples: [...new Set(categories)], reviewError: error.message };
    }
  }
};
await Promise.all(Array.from({ length: Math.min(5, selected.length) }, worker));

const randomRows = reviewed.filter((row) => row.random50);
const count = (predicate) => randomRows.filter(predicate).length;
const audit = {
  sourceArtifact: inputPath,
  seed: '0x43484149',
  randomUniqueTransactionSample: randomRows.length,
  topReasons,
  categoryValidationSampleCounts: Object.fromEntries(Object.entries(categorySamples).map(([reason, rows]) => [reason, rows.length])),
  txFromAudit: {
    lookedUp: randomRows.filter((row) => !row.reviewError).length,
    eoa: count((row) => row.txFromIsContract === false),
    contract: count((row) => row.txFromIsContract === true),
    contractStatusUnknown: count((row) => row.txFromIsContract === null || row.txFromIsContract === undefined),
    knownRouter: count((row) => row.knownRouterTxFrom),
    aggregatorTransaction: count((row) => row.aggregatorEvidence),
    smartAccountOrBundlerEvidence: count((row) => row.smartAccountOrBundlerEvidence),
    txFromEqualsUniqueTerminalRecipient: count((row) => row.txFromMatchesUniqueTerminalRecipient),
  },
  reviews: reviewed,
};
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(`TX.FROM audit saved: ${outputPath}`);
console.log(`Random unique uncertain transactions: ${audit.randomUniqueTransactionSample}; successful Blockscout lookups: ${audit.txFromAudit.lookedUp}`);
console.log(JSON.stringify(audit.txFromAudit));
console.log('Top reason category sample counts:', JSON.stringify(audit.categoryValidationSampleCounts));
for (const reason of topReasons) {
  const rows = reviewed.filter((row) => row.topCategorySamples?.includes(reason));
  console.log(`${reason}: ${rows.length} reviewed; actual buys=${rows.filter((row) => row.actualBuy).length}; unique EOA endpoint=${rows.filter((row) => row.safeToAutomate && row.actualWallet !== null).length}; manual API failures=${rows.filter((row) => row.reviewError).length}`);
}
