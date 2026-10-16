import { readFile } from 'node:fs/promises';

export function aggregateSnapshots(snapshots, { threshold = 250 } = {}) {
  if (![250, 500].includes(Number(threshold))) throw new Error('threshold must be 250 or 500');
  const thresholdKey = `threshold${Number(threshold)}`;
  const wallets = new Map();
  for (const snapshot of snapshots) {
    if (!snapshot?.snapshotAt || !Array.isArray(snapshot.walletTokenCombinations)) {
      throw new Error('Each snapshot must include snapshotAt and walletTokenCombinations');
    }
    const snapshotId = String(snapshot.snapshotAt);
    for (const row of snapshot.walletTokenCombinations) {
      if (!row[thresholdKey]) continue;
      const stats = row[`${thresholdKey}Stats`] ?? row;
      const walletAddress = String(row.wallet ?? '').toLowerCase();
      const chain = String(row.chain ?? '').toLowerCase();
      const contract = String(row.contract ?? '').toLowerCase();
      if (!walletAddress || !chain || !/^0x[\da-f]{40}$/.test(contract)) continue;
      let wallet = wallets.get(walletAddress);
      if (!wallet) {
        wallet = { wallet: walletAddress, snapshotsHit: new Set(), tokens: new Map() };
        wallets.set(walletAddress, wallet);
      }
      wallet.snapshotsHit.add(snapshotId);
      const tokenKey = `${chain}:${contract}`;
      const leadTimeHours = Number(stats.leadTimeHours ?? row.leadTimeHours);
      const totalUsdBought = Number(stats.totalUsdBought ?? row.totalUsdBought);
      const prior = wallet.tokens.get(tokenKey);
      const observation = { chain, contract, token: row.token, leadTimeHours, totalUsdBought };
      // Repeated appearances of one canonical token do not add token hits or dollars.
      // Keep the largest observed lead time and its corresponding snapshot total.
      if (!prior || (Number.isFinite(leadTimeHours) && leadTimeHours > prior.leadTimeHours)
        || (leadTimeHours === prior.leadTimeHours && totalUsdBought > prior.totalUsdBought)) {
        wallet.tokens.set(tokenKey, observation);
      }
    }
  }
  return [...wallets.values()].map((wallet) => {
    const uniqueTokens = [...wallet.tokens.values()];
    const validLeadTimes = uniqueTokens.map((item) => item.leadTimeHours).filter(Number.isFinite);
    return { wallet: wallet.wallet, uniqueTrendingTokensHit: uniqueTokens.length, snapshotsHit: wallet.snapshotsHit.size,
      avgLeadTimeHours: validLeadTimes.length ? validLeadTimes.reduce((sum, item) => sum + item, 0) / validLeadTimes.length : null,
      totalUsdBought: uniqueTokens.reduce((sum, item) => sum + (Number.isFinite(item.totalUsdBought) ? item.totalUsdBought : 0), 0),
      tokens: uniqueTokens };
  }).sort((a, b) => b.uniqueTrendingTokensHit - a.uniqueTrendingTokensHit
    || (b.avgLeadTimeHours ?? -Infinity) - (a.avgLeadTimeHours ?? -Infinity)
    || b.totalUsdBought - a.totalUsdBought);
}

async function main() {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const threshold = Number(process.argv.find((arg) => arg.startsWith('--threshold='))?.split('=')[1] ?? 250);
  if (!files.length) throw new Error('Usage: node scripts/trending-early-buyers-longitudinal.mjs <snapshot.json> [snapshot.json ...] [--threshold=250|500]');
  const snapshots = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
  const result = aggregateSnapshots(snapshots, { threshold });
  console.log(`LONGITUDINAL THRESHOLD >= $${threshold}; snapshots=${snapshots.length}; ranked wallets=${result.length}`);
  console.log('| Rank | Wallet | Unique trending tokens | Snapshots hit | Avg lead hours | Total USD bought | Tokens (chain:contract) |');
  console.log('|---:|---|---:|---:|---:|---:|---|');
  result.slice(0, 20).forEach((wallet, index) => console.log(`| ${index + 1} | ${wallet.wallet} | ${wallet.uniqueTrendingTokensHit} | ${wallet.snapshotsHit} | ${wallet.avgLeadTimeHours?.toFixed(1) ?? 'N/A'} | $${wallet.totalUsdBought.toFixed(2)} | ${wallet.tokens.map((token) => `${token.chain}:${token.contract}`).join(', ')} |`));
}

if (process.argv[1]?.endsWith('trending-early-buyers-longitudinal.mjs')) {
  main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
