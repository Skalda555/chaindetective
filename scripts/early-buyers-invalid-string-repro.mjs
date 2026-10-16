import '../server/load-env.mjs';
import { runEarlyBuyersScan } from '../server/early-buyers-engine.mjs';

Error.stackTraceLimit = 100;
try {
  await runEarlyBuyersScan({ apiToken: process.env.ENVIO_API_TOKEN, validate: false, writeArtifact: process.argv.includes('--save-artifact') });
} catch (error) {
  console.error(`ISOLATED BASE REPRO ERROR STACK\n${error?.stack ?? error}`);
  process.exitCode = 1;
}
