export function unixSecondAtOrAfter(timestampMs) {
  const value = Number(timestampMs);
  if (!Number.isFinite(value)) throw new Error('Timestamp must be a finite Unix millisecond value.');
  return Math.ceil(value / 1000);
}

export async function resolveFirstBlockAtOrAfter({
  targetTimestamp,
  initialEstimate,
  headBlock,
  getBlockTimestamp,
  waitForNextHead,
}) {
  if (!Number.isSafeInteger(targetTimestamp)) throw new Error('Block timestamp target must be an integer.');
  if (!Number.isSafeInteger(headBlock) || headBlock < 0) throw new Error('Initial head block must be a non-negative integer.');
  if (typeof getBlockTimestamp !== 'function') throw new Error('getBlockTimestamp callback is required.');
  if (typeof waitForNextHead !== 'function') throw new Error('waitForNextHead callback is required.');

  const timestamps = new Map();
  const timestampAt = async (blockNumber) => {
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) throw new Error(`Invalid block number ${blockNumber}.`);
    if (!timestamps.has(blockNumber)) {
      const timestamp = Number(await getBlockTimestamp(blockNumber));
      if (!Number.isSafeInteger(timestamp)) throw new Error(`No valid timestamp for block ${blockNumber}.`);
      timestamps.set(blockNumber, timestamp);
    }
    return timestamps.get(blockNumber);
  };

  let head = headBlock;
  const estimate = typeof initialEstimate === 'function' ? initialEstimate(targetTimestamp) : initialEstimate;
  if (!Number.isFinite(Number(estimate))) throw new Error('Initial block estimate must be finite.');
  let probe = Math.min(head, Math.max(0, Math.trunc(Number(estimate))));
  let probeTimestamp = await timestampAt(probe);
  let low = null;
  let high = null;

  if (probeTimestamp >= targetTimestamp) {
    high = probe;
    let step = 1;
    while (high > 0 && low === null) {
      const candidate = Math.max(0, probe - step);
      const timestamp = await timestampAt(candidate);
      if (timestamp < targetTimestamp) low = candidate;
      else high = candidate;
      probe = candidate;
      step *= 2;
    }
    if (low === null) return 0;
  } else {
    low = probe;
    let step = 1;
    while (high === null) {
      let candidate = probe + step;
      if (candidate > head) {
        if (head > probe) {
          candidate = head;
          const timestamp = await timestampAt(candidate);
          if (timestamp >= targetTimestamp) high = candidate;
          else { low = candidate; probe = candidate; }
        }
        if (high !== null) break;
        const nextHead = Number(await waitForNextHead(head, targetTimestamp));
        if (!Number.isSafeInteger(nextHead) || nextHead <= head) {
          throw new Error(`Could not advance HyperSync head beyond block ${head} while resolving timestamp ${targetTimestamp}.`);
        }
        head = nextHead;
        candidate = Math.min(head, probe + step);
      }
      const timestamp = await timestampAt(candidate);
      if (timestamp >= targetTimestamp) high = candidate;
      else low = candidate;
      probe = candidate;
      step *= 2;
    }
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (await timestampAt(middle) >= targetTimestamp) high = middle;
    else low = middle;
  }
  return high;
}

export async function resolveTimestampWindow(startTimestamp, endTimestamp, options) {
  if (!Number.isSafeInteger(startTimestamp) || !Number.isSafeInteger(endTimestamp)) {
    throw new Error('Block timestamp window boundaries must be integer Unix timestamps.');
  }
  if (endTimestamp < startTimestamp) throw new Error('Block timestamp window end precedes its start.');
  const [fromBlock, toBlock] = await Promise.all([
    resolveFirstBlockAtOrAfter({ ...options, targetTimestamp: startTimestamp }),
    resolveFirstBlockAtOrAfter({ ...options, targetTimestamp: endTimestamp }),
  ]);
  if (fromBlock > toBlock) throw new Error(`Resolved block window is reversed (${fromBlock} > ${toBlock}).`);
  return { fromBlock, toBlock };
}
