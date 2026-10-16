import '../server/load-env.mjs';
import { isIgnoredWalletAddress } from '../dist/data.js';

const CG_API = 'https://api.coingecko.com/api/v3';
const DEX_API = 'https://api.dexscreener.com';
const DUNE_API = 'https://api.dune.com/api/v1';
const CHAINS = Object.freeze({ ethereum: 'ethereum', base: 'base' });
const MIN_LIQUIDITY_USD = 10_000;
const MIN_BUY_USD = 500;
const TOKEN_LIMIT = 3;
const WALLET_LIMIT = 30;
const ADDRESS_RE = /^0x[\da-f]{40}$/i;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}: ${body.slice(0, 800)}`);
  try { return JSON.parse(body); }
  catch { throw new Error(`Invalid JSON returned by ${url}: ${body.slice(0, 300)}`); }
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function time(value) {
  return value ? new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : '—';
}

function normalizedAddress(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

async function discoverTrendingTokens() {
  const [trending, coinList] = await Promise.all([
    fetchJson(`${CG_API}/search/trending`),
    fetchJson(`${CG_API}/coins/list?include_platform=true`),
  ]);
  const platformMap = new Map(coinList.map((coin) => [coin.id, coin.platforms ?? {}]));
  const candidates = (trending.coins ?? []).map((entry, index) => ({
    rank: index + 1,
    item: entry.item,
    platforms: platformMap.get(entry.item.id) ?? {},
  }));
  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= TOKEN_LIMIT) break;
    const contracts = Object.entries(CHAINS)
      .map(([chain, platformId]) => ({ chain, contract: candidate.platforms[platformId] }))
      .filter(({ contract }) => typeof contract === 'string' && ADDRESS_RE.test(contract));
    if (!contracts.length) continue;

    const discoveries = await Promise.all(contracts.map(async ({ chain, contract }) => {
      const pairs = await fetchJson(`${DEX_API}/token-pairs/v1/${chain}/${contract}`);
      const relevant = (Array.isArray(pairs) ? pairs : [])
        .filter((pair) => pair.chainId === chain && Number(pair.liquidity?.usd) >= MIN_LIQUIDITY_USD)
        .filter((pair) => normalizedAddress(pair.baseToken?.address) === normalizedAddress(contract)
          || normalizedAddress(pair.quoteToken?.address) === normalizedAddress(contract));
      return { chain, contract, pairs: relevant };
    }));

    const activeNetworks = discoveries.map((discovery) => ({
      ...discovery,
      totalLiquidity: discovery.pairs.reduce((sum, pair) => sum + (Number(pair.liquidity?.usd) || 0), 0),
      totalVolume24h: discovery.pairs.reduce((sum, pair) => sum + (Number(pair.volume?.h24) || 0), 0),
    })).filter(({ pairs }) => pairs.length)
      .sort((a, b) => b.totalVolume24h - a.totalVolume24h || b.totalLiquidity - a.totalLiquidity);
    if (!activeNetworks.length) continue;

    const network = activeNetworks[0];
    const pair = [...network.pairs].sort((a, b) =>
      (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0)
      || (Number(b.volume?.h24) || 0) - (Number(a.volume?.h24) || 0))[0];
    selected.push({
      rank: candidate.rank,
      id: candidate.item.id,
      name: candidate.item.name,
      symbol: candidate.item.symbol,
      chain: network.chain,
      contract: network.contract,
      pair,
      networkLiquidity: network.totalLiquidity,
      networkVolume24h: network.totalVolume24h,
      consideredNetworks: activeNetworks,
    });
  }
  if (selected.length !== TOKEN_LIMIT) {
    throw new Error(`CoinGecko/DEX Screener yielded ${selected.length} eligible token(s); exactly ${TOKEN_LIMIT} were required. The available trending list had ${candidates.length} coins.`);
  }
  return selected;
}

function printSelected(tokens) {
  console.log('\nA) VYBRANÉ COINGECKO TRENDING TOKENY');
  for (const token of tokens) {
    const pair = token.pair;
    const age = pair.pairCreatedAt ? `${((Date.now() - pair.pairCreatedAt) / 86_400_000).toFixed(1)} dní` : 'NEOVĚŘENO';
    const networks = token.consideredNetworks.map((item) => `${item.chain}: likvidita ${money(item.totalLiquidity)}, volume24h ${money(item.totalVolume24h)}`).join(' | ');
    console.log(`\n#${token.rank} ${token.symbol} (${token.name})`);
    console.log(`CoinGecko ID: ${token.id}`);
    console.log(`Síť/contract: ${token.chain} / ${token.contract}`);
    console.log(`Největší pair podle likvidity: ${pair.pairAddress} (${pair.dexId ?? 'DEX'})`);
    console.log(`Pair liquidity: ${money(pair.liquidity?.usd)} | pair volume 24h: ${money(pair.volume?.h24)} | stáří: ${age}`);
    console.log(`DEX rozhodnutí (páry s likviditou >= ${money(MIN_LIQUIDITY_USD)}): ${networks}`);
  }
}

function sqlFor(tokens) {
  const contracts = tokens.map((token) => `('${token.chain}', 0x${token.contract.slice(2).toLowerCase()})`).join(',\n    ');
  return `WITH watched(chain, token_contract) AS (\n  VALUES\n    ${contracts}\n)\nSELECT\n  t.blockchain AS chain,\n  concat('0x', lower(to_hex(t.token_bought_address))) AS token_contract,\n  t.token_bought_symbol AS token_symbol,\n  concat('0x', lower(to_hex(t.taker))) AS wallet_address,\n  t.block_time AS timestamp,\n  concat('0x', lower(to_hex(t.tx_hash))) AS tx_hash,\n  t.amount_usd AS amount_usd\nFROM dex.trades AS t\nINNER JOIN watched AS w\n  ON t.blockchain = w.chain\n AND t.token_bought_address = w.token_contract\nWHERE t.blockchain IN (${[...new Set(tokens.map((token) => `'${token.chain}'`))].join(', ')})\n  AND t.block_time >= now() - INTERVAL '7' day\n  AND t.block_time < now() - INTERVAL '1' day\n  AND t.amount_usd >= ${MIN_BUY_USD}\nORDER BY t.block_time ASC`;
}

async function runDune(sql) {
  const apiKey = process.env.DUNE_API_KEY;
  const startedAt = Date.now();
  const execution = await fetchJson(`${DUNE_API}/sql/execute`, {
    method: 'POST',
    headers: { 'X-Dune-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, performance: 'medium' }),
  });
  if (!execution.execution_id) throw new Error(`Dune execution request returned no execution_id: ${JSON.stringify(execution)}`);
  console.log(`Dune execution ID: ${execution.execution_id}`);

  let state = execution.state;
  while (state && !['QUERY_STATE_COMPLETED', 'QUERY_STATE_FAILED', 'QUERY_STATE_CANCELLED'].includes(state)) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const status = await fetchJson(`${DUNE_API}/execution/${encodeURIComponent(execution.execution_id)}/status`, {
      headers: { 'X-Dune-Api-Key': apiKey },
    });
    state = status.state;
    if (status.error) throw new Error(`Dune execution ${state}: ${status.error}`);
  }
  if (state !== 'QUERY_STATE_COMPLETED') throw new Error(`Dune execution ${execution.execution_id} finished with state ${state ?? 'UNKNOWN'}`);
  const result = await fetchJson(`${DUNE_API}/execution/${encodeURIComponent(execution.execution_id)}/results`, {
    headers: { 'X-Dune-Api-Key': apiKey },
  });
  console.log(`Dune execution time: ${((Date.now() - startedAt) / 1000).toFixed(1)} s wall-clock (API-reported ${result.execution_time ?? 'NEOVĚŘENO'})`);
  console.log(`Dune credits/usage: ${result.usage?.credits ?? result.credits_used ?? 'NEOVĚŘENO'}`);
  return { rows: result.result?.rows ?? [], executionId: execution.execution_id };
}

function aggregateTrades(rows, tokens) {
  const metadata = new Map(tokens.map((token) => [`${token.chain}:${token.contract.toLowerCase()}`, token]));
  const trades = rows.map((row) => {
    const tokenContract = normalizedAddress(row.token_contract);
    const chain = String(row.chain ?? '').toLowerCase();
    const token = metadata.get(`${chain}:${tokenContract}`);
    return token && {
      chain, tokenContract, tokenSymbol: token.symbol,
      walletAddress: normalizedAddress(row.wallet_address),
      timestamp: new Date(row.timestamp).toISOString(), txHash: normalizedAddress(row.tx_hash),
      amountUsd: Number(row.amount_usd),
    };
  }).filter((trade) => trade && ADDRESS_RE.test(trade.walletAddress) && !isIgnoredWalletAddress(trade.walletAddress) && trade.txHash && Number.isFinite(trade.amountUsd));

  const tokenAgg = new Map();
  for (const trade of trades) {
    const key = `${trade.walletAddress}:${trade.chain}:${trade.tokenContract}`;
    const agg = tokenAgg.get(key) ?? { wallet: trade.walletAddress, chain: trade.chain, tokenContract: trade.tokenContract, tokenSymbol: trade.tokenSymbol, firstBuyAt: trade.timestamp, lastBuyAt: trade.timestamp, buyCount: 0, totalUsdBought: 0, sampleTxHash: trade.txHash };
    agg.firstBuyAt = trade.timestamp < agg.firstBuyAt ? trade.timestamp : agg.firstBuyAt;
    agg.lastBuyAt = trade.timestamp > agg.lastBuyAt ? trade.timestamp : agg.lastBuyAt;
    agg.buyCount += 1;
    agg.totalUsdBought += trade.amountUsd;
    tokenAgg.set(key, agg);
  }

  const walletAgg = new Map();
  for (const agg of tokenAgg.values()) {
    const wallet = walletAgg.get(agg.wallet) ?? { wallet: agg.wallet, tokenDetails: [], totalUsdBought: 0, earliestBuyAt: agg.firstBuyAt, latestBuyAt: agg.lastBuyAt, leadTimeSumHours: 0 };
    wallet.tokenDetails.push(agg);
    wallet.totalUsdBought += agg.totalUsdBought;
    wallet.earliestBuyAt = agg.firstBuyAt < wallet.earliestBuyAt ? agg.firstBuyAt : wallet.earliestBuyAt;
    wallet.latestBuyAt = agg.lastBuyAt > wallet.latestBuyAt ? agg.lastBuyAt : wallet.latestBuyAt;
    wallet.leadTimeSumHours += (Date.now() - Date.parse(agg.firstBuyAt)) / 3_600_000;
    walletAgg.set(agg.wallet, wallet);
  }
  const wallets = [...walletAgg.values()].map((wallet) => ({
    ...wallet,
    trendingTokensCount: wallet.tokenDetails.length,
    averageLeadTimeHours: wallet.leadTimeSumHours / wallet.tokenDetails.length,
    tokenDetails: wallet.tokenDetails.sort((a, b) => a.firstBuyAt.localeCompare(b.firstBuyAt)),
  })).sort((a, b) => b.trendingTokensCount - a.trendingTokensCount || b.totalUsdBought - a.totalUsdBought);
  return { trades, tokenAgg, wallets };
}

function printResults(tokens, { trades, tokenAgg, wallets }) {
  console.log('\nB) STATISTIKY BUY TRADES');
  for (const token of tokens) {
    const found = trades.filter((trade) => trade.chain === token.chain && trade.tokenContract === token.contract.toLowerCase());
    const uniqueWallets = new Set(found.map((trade) => trade.walletAddress));
    console.log(`${token.symbol} (${token.chain}): ${found.length} BUY trades >= ${money(MIN_BUY_USD)} | ${uniqueWallets.size} unique wallets | ${money(found.reduce((sum, trade) => sum + trade.amountUsd, 0))} volume`);
  }

  console.log('\nC) TOP WALLETS');
  console.log('| Rank | Wallet | Trending tokens | Tokens | Total bought USD | First buy | Last buy |');
  console.log('|---:|---|---:|---|---:|---|---|');
  for (const [index, wallet] of wallets.slice(0, WALLET_LIMIT).entries()) {
    console.log(`| ${index + 1} | ${wallet.wallet} | ${wallet.trendingTokensCount} | ${wallet.tokenDetails.map((item) => item.tokenSymbol).join(', ')} | ${money(wallet.totalUsdBought)} | ${time(wallet.earliestBuyAt)} | ${time(wallet.latestBuyAt)} |`);
  }

  console.log('\nD) DETAIL TOP 10 WALLETS');
  for (const wallet of wallets.slice(0, 10)) {
    console.log(`\n${wallet.wallet} | trendingTokensCount=${wallet.trendingTokensCount} | avg lead=${wallet.averageLeadTimeHours.toFixed(1)}h`);
    for (const item of wallet.tokenDetails) {
      console.log(`  ${item.tokenSymbol} (${item.chain}): first ${time(item.firstBuyAt)}; last ${time(item.lastBuyAt)}; buys ${item.buyCount}; total ${money(item.totalUsdBought)}; sample tx ${item.sampleTxHash}`);
      console.log(`  Explorer: ${item.chain === 'ethereum' ? 'https://eth.blockscout.com' : 'https://base.blockscout.com'}/tx/${item.sampleTxHash}`);
    }
  }

  console.log('\nE) INTERSECTION A WALLET IDENTITY');
  for (const count of [1, 2, 3]) console.log(`Wallets se ${count} trending token${count === 1 ? 'em' : 'y'}: ${wallets.filter((wallet) => wallet.trendingTokensCount === count).length}`);
  console.log('Wallet identity: dex.trades.taker — Dune schema jej popisuje jako adresu, která token koupila; pole může představovat EOA nebo kontrakt. Pool/router pole project_contract_address použito nebylo.');
  console.log(`Dune dataset/table: dex.trades | BUY = token_bought_address je sledovaný contract, amount_usd >= ${MIN_BUY_USD}, block_time >= now()-7d a < now()-1d.`);
  console.log('Spray-and-pray upozornění: peněženka se 2–3 trending tokeny nemusí být smart money, pokud nakupuje stovky tokenů týdně. distinctTokensBought7d a hitRate tento PoC zatím nepočítá.');
  console.log('Vzorkové ověření: následuje kontrola 5 unikátních Dune trade vzorků přes veřejné Blockscout API, pokud jsou dostupné.');
  console.log('Dune API usage/credits: NEOVĚŘENO, pokud odpověď nevrátí usage field.');
}

async function verifyTradeSamples(trades, wallets) {
  const topWallets = new Set(wallets.slice(0, 10).map((wallet) => wallet.wallet));
  const selected = [];
  const seen = new Set();
  for (const trade of trades) {
    if (!topWallets.has(trade.walletAddress)) continue;
    const key = `${trade.chain}:${trade.txHash}:${trade.tokenContract}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(trade);
    if (selected.length === 5) break;
  }
  if (!selected.length) {
    console.log('\nVzorkové ověření: NEPROVEDENO — žádné Dune trades od Top 10 wallets.');
    return;
  }

  console.log(`\nVzorkové ověření přes veřejné Blockscout API (${selected.length} trades; cíl alespoň 5):`);
  const hosts = { ethereum: 'https://eth.blockscout.com/api/v2', base: 'https://base.blockscout.com/api/v2' };
  const windowStart = Date.now() - 7 * 86_400_000;
  const windowEnd = Date.now() - 1 * 86_400_000;
  for (const trade of selected) {
    try {
      const base = hosts[trade.chain];
      const [tx, transferResult] = await Promise.all([
        fetchJson(`${base}/transactions/${trade.txHash}`),
        fetchJson(`${base}/transactions/${trade.txHash}/token-transfers?type=ERC-20`),
      ]);
      const transfers = transferResult.items ?? [];
      const matching = transfers.find((transfer) =>
        normalizedAddress(transfer.token?.address) === trade.tokenContract
        && normalizedAddress(transfer.to?.hash) === trade.walletAddress);
      const timestamp = Date.parse(tx.timestamp);
      const exists = normalizedAddress(tx.hash) === trade.txHash;
      const targetBoughtByWallet = Boolean(matching);
      const inWindow = Number.isFinite(timestamp) && timestamp >= windowStart && timestamp < windowEnd;
      const amountUsdPlausible = trade.amountUsd >= MIN_BUY_USD && trade.amountUsd <= 100_000_000;
      const ok = exists && targetBoughtByWallet && inWindow && amountUsdPlausible;
      console.log(`${ok ? 'PASS' : 'CHECK'} ${trade.chain} ${trade.txHash} | tx exists=${exists} | target token sent to taker=${targetBoughtByWallet} | timestamp in window=${inWindow} | Dune USD ${money(trade.amountUsd)} plausible-range=${amountUsdPlausible}`);
    } catch (error) {
      console.log(`FAIL ${trade.chain} ${trade.txHash} | explorer check error: ${error.message}`);
    }
  }
  if (selected.length < 5) console.log(`Upozornění: k dispozici pouze ${selected.length} unikátních sample trades; nelze dosáhnout požadovaných 5.`);
  console.log('Pozn.: Blockscout ověřuje on-chain transfer a čas; USD částka pochází z Dune amount_usd a nezávislá cenová rekonstrukce se neprovádí.');
}

async function main() {
  let tokens;
  try {
    tokens = await discoverTrendingTokens();
    printSelected(tokens);
  } catch (error) {
    console.error(`CoinGecko/DEX Screener discovery failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (!process.env.DUNE_API_KEY) {
    console.log('\nK provedení live testu chybí DUNE_API_KEY');
    console.log('Dune SQL nebylo odesláno a žádná Dune execution nebyla vytvořena.');
    return;
  }

  let duneResult;
  try {
    duneResult = await runDune(sqlFor(tokens));
  } catch (error) {
    console.error(`Dune query failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const results = aggregateTrades(duneResult.rows, tokens);
  printResults(tokens, results);
  await verifyTradeSamples(results.trades, results.wallets);
  console.log(`\nDune execution ID: ${duneResult.executionId}`);
}

await main();
