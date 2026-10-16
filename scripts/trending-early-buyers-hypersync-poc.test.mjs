import assert from 'node:assert/strict';
import { DEAD_ADDRESS } from '../dist/data.js';
import { blockscoutTokenAddress, decodeSwap, inferTargetSideFromOutput, quoteInputRaw, resolvePositiveTokenRecipients, sumBlockscoutTransfers, targetOutputRaw } from './trending-early-buyers-decode.mjs';

const V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const addrTopic = (address) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
const word = (value) => BigInt.asUintN(256, BigInt(value)).toString(16).padStart(64, '0');

// Raw V2 Swap: token1 in (1,000 USDC raw units = 0.001 USDC in this fixture), token0 out (1 WETH).
const v2Buy = {
  topics: [V2_TOPIC, addrTopic('0x1111111111111111111111111111111111111111'), addrTopic('0x2222222222222222222222222222222222222222')],
  data: `0x${word(0n)}${word(1_000n)}${word(10n ** 18n)}${word(0n)}`,
};
const decodedV2 = decodeSwap(v2Buy);
assert.ok(decodedV2, 'decodes a V2 Swap log');
assert.equal(inferTargetSideFromOutput(decodedV2, 10n ** 18n), 'token0');
assert.equal(targetOutputRaw(decodedV2, true), 10n ** 18n);
assert.equal(quoteInputRaw(decodedV2, 'token0'), 1_000n);
assert.equal(inferTargetSideFromOutput(decodedV2, 1n), null, 'rejects output amount that does not match either side');

// Raw V3 Swap: amount0 is negative from pool perspective (pool sends token0), amount1 is positive (pool receives token1).
const v3Buy = {
  topics: [V3_TOPIC, addrTopic('0x1111111111111111111111111111111111111111'), addrTopic('0x2222222222222222222222222222222222222222')],
  data: `0x${word(-(10n ** 18n))}${word(250_000_000n)}${word(0n)}${word(0n)}${word(0n)}`,
};
const decodedV3 = decodeSwap(v3Buy);
assert.ok(decodedV3, 'decodes a V3 Swap log');
assert.equal(decodedV3.amount0Out, 10n ** 18n, 'negative amount0 means the pool emitted token0');
assert.equal(decodedV3.amount1In, 250_000_000n, 'positive amount1 means the pool received token1');
assert.equal(inferTargetSideFromOutput(decodedV3, 10n ** 18n), 'token0');
assert.equal(quoteInputRaw(decodedV3, 'token0'), 250_000_000n);

const v3Sell = { ...v3Buy, data: `0x${word(10n ** 18n)}${word(-250_000_000n)}${word(0n)}${word(0n)}${word(0n)}` };
const decodedV3Sell = decodeSwap(v3Sell);
assert.equal(decodedV3Sell.amount0Out, 0n, 'positive amount0 is pool input, not target output');
assert.equal(decodedV3Sell.amount1Out, 250_000_000n, 'negative amount1 means the pool emitted token1');
assert.equal(decodeSwap({ topics: ['0x' + '00'.repeat(32)], data: '0x' }), null);

// Blockscout v2 uses token.address_hash. A multihop transaction may deliver the same token
// to a wallet from more than one pool, so the trade sample must match the selected source pool.
const tokenAddress = '0xe28b3b32b6c345a34ff64674606124dd5aceca30';
const walletAddress = '0xa9ee875e08e5c8f62d402d4ac4cb75658180f50a';
const selectedPool = '0x6c063a6e8cd45869b5eb75291e65a3de298f3aa8';
const otherPool = '0x73a19c186d19b08847d6f02350466c5a4826ce61';
const blockscoutTransfers = [
  { token: { address_hash: tokenAddress.toUpperCase().replace('0X', '0x') }, from: { hash: selectedPool }, to: { hash: walletAddress }, total: { value: '99649340000000000000' } },
  { token: { address_hash: tokenAddress }, from: { hash: otherPool }, to: { hash: walletAddress }, total: { value: '42706860000000000000' } },
  { token: { address_hash: tokenAddress }, from: { hash: selectedPool }, to: { hash: '0x3333333333333333333333333333333333333333' }, total: { value: '1' } },
];
assert.equal(blockscoutTokenAddress(blockscoutTransfers[0]), tokenAddress);
assert.equal(sumBlockscoutTransfers(blockscoutTransfers, {
  tokenAddress, fromAddress: selectedPool, toAddress: walletAddress,
}), 99649340000000000000n, 'Blockscout address_hash fixture sums only the selected pool-to-wallet leg');
assert.equal(sumBlockscoutTransfers(blockscoutTransfers, {
  tokenAddress, toAddress: walletAddress,
}), 142356200000000000000n, 'unfiltered receipt includes the other multihop pool and must not validate a single pool leg');

const router = '0x4444444444444444444444444444444444444444';
const recipientFlow = [
  { token: tokenAddress, from: selectedPool, to: router, amount: 100n },
  { token: tokenAddress, from: router, to: walletAddress, amount: 100n },
];
const endpoints = resolvePositiveTokenRecipients(recipientFlow, { tokenAddress, excludedAddresses: [selectedPool, otherPool, router] });
assert.deepEqual(endpoints.map((item) => [item.address, item.netDelta]), [[walletAddress, 100n]], 'multihop intermediate nets to zero; end recipients remain independently visible');
assert.equal(resolvePositiveTokenRecipients([...recipientFlow,
  { token: tokenAddress, from: otherPool, to: '0x5555555555555555555555555555555555555555', amount: 30n },
], { tokenAddress, excludedAddresses: [selectedPool, otherPool, router] }).length, 2, 'separate positive recipients remain ambiguous');
const burnFlow=resolvePositiveTokenRecipients([...recipientFlow,
  {token:tokenAddress,from:walletAddress,to:DEAD_ADDRESS.toUpperCase().replace(/^0X/,'0x'),amount:250n},
  {token:tokenAddress,from:DEAD_ADDRESS,to:'0x5555555555555555555555555555555555555555',amount:70n},
],{tokenAddress,excludedAddresses:[selectedPool,otherPool,router]});
assert.deepEqual(burnFlow.map(item=>item.address),[walletAddress],'burn transfers and dead recipients cannot become wallet candidates');

console.log('HyperSync PoC swap decoder fixtures passed (V2, V3 buy/sell direction, invalid topic).');
