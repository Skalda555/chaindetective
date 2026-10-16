import { decodeEventLog, parseAbiItem, toEventSelector } from 'viem';
import { isIgnoredWalletAddress, normalizeAddress } from '../dist/data.js';

const V2 = parseAbiItem('event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)');
const V3 = parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)');

export const SWAP_ABIS = new Map([
  ['uniswap-v2', V2],
  ['uniswap-v3', V3],
]);

export const SWAP_TOPIC_TO_KIND = new Map([...SWAP_ABIS].map(([kind, abi]) => [toEventSelector(abi).toLowerCase(), kind]));

export function swapEventFor(kind) {
  const abi = SWAP_ABIS.get(kind);
  return abi ? { kind, abi } : null;
}

export function decodeSwap(log) {
  const kind = SWAP_TOPIC_TO_KIND.get(String(log.topics?.[0] ?? '').toLowerCase());
  if (!kind) return null;
  try {
    const args = decodeEventLog({ abi: [SWAP_ABIS.get(kind)], data: log.data, topics: log.topics }).args;
    if (kind === 'uniswap-v3') {
      const amount0 = BigInt(args.amount0);
      const amount1 = BigInt(args.amount1);
      return {
        kind, args, amount0, amount1,
        amount0Out: amount0 < 0n ? -amount0 : 0n,
        amount1Out: amount1 < 0n ? -amount1 : 0n,
        amount0In: amount0 > 0n ? amount0 : 0n,
        amount1In: amount1 > 0n ? amount1 : 0n,
      };
    }
    return {
      kind, args,
      amount0In: BigInt(args.amount0In), amount1In: BigInt(args.amount1In),
      amount0Out: BigInt(args.amount0Out), amount1Out: BigInt(args.amount1Out),
    };
  } catch {
    return null;
  }
}

export function targetOutputRaw(decoded, targetIsToken0) {
  if (!decoded) return 0n;
  return targetIsToken0 ? decoded.amount0Out : decoded.amount1Out;
}

export function inferTargetSideFromOutput(decoded, targetPoolOutput) {
  if (!decoded || targetPoolOutput <= 0n) return null;
  const matches = [];
  if (decoded.amount0Out === targetPoolOutput) matches.push('token0');
  if (decoded.amount1Out === targetPoolOutput) matches.push('token1');
  return matches.length === 1 ? matches[0] : null;
}

export function quoteInputRaw(decoded, targetSide) {
  if (!decoded || !['token0', 'token1'].includes(targetSide)) return 0n;
  return targetSide === 'token0' ? decoded.amount1In : decoded.amount0In;
}

export function blockscoutTokenAddress(transfer) {
  return String(transfer?.token?.address_hash ?? transfer?.token?.address ?? '').toLowerCase();
}

export function sumBlockscoutTransfers(items, { tokenAddress, fromAddress, toAddress }) {
  const token = String(tokenAddress ?? '').toLowerCase();
  const from = fromAddress === undefined ? null : String(fromAddress).toLowerCase();
  const to = toAddress === undefined ? null : String(toAddress).toLowerCase();
  return (items ?? []).filter((item) => blockscoutTokenAddress(item) === token
    && (from === null || String(item.from?.hash ?? '').toLowerCase() === from)
    && (to === null || String(item.to?.hash ?? '').toLowerCase() === to))
    .reduce((sum, item) => sum + BigInt(item.total?.value ?? 0), 0n);
}

export function resolvePositiveTokenRecipients(transfers, { tokenAddress, excludedAddresses = [] }) {
  const token = normalizeAddress(tokenAddress);
  if (!token) return [];
  const excluded = new Set((excludedAddresses ?? []).map(normalizeAddress).filter(Boolean));
  const balances = new Map();
  for (const transfer of transfers ?? []) {
    if (normalizeAddress(transfer.token) !== token) continue;
    const from = normalizeAddress(transfer.from);
    const to = normalizeAddress(transfer.to);
    const amount = BigInt(transfer.amount ?? 0);
    if (!amount || !from || !to || isIgnoredWalletAddress(from) || isIgnoredWalletAddress(to)) continue;
    const fromBalance = balances.get(from) ?? { received: 0n, sent: 0n };
    fromBalance.sent += amount;
    balances.set(from, fromBalance);
    const toBalance = balances.get(to) ?? { received: 0n, sent: 0n };
    toBalance.received += amount;
    balances.set(to, toBalance);
  }
  return [...balances.entries()].filter(([address, balance]) => !excluded.has(address) && balance.received > balance.sent)
    .map(([address, balance]) => ({ address, received: balance.received, sent: balance.sent, netDelta: balance.received - balance.sent }))
    .sort((a, b) => a.address.localeCompare(b.address));
}
