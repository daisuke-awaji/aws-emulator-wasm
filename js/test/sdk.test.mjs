// Round-trips AWS SDK v3 calls through the wasm emulator in Node, once with node:wasi
// (real clocks) and once with the WASI shim the browser uses (virtual clock).
// Needs EMULATOR_WASM=<path to the .wasm>; skipped without it. CI runs it against both the
// cargo build and the wasm-opt build (their WASI imports differ).
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { loadEmulator, nodeResponseBody } from '../src/emulator.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';
import { scenarios } from './scenarios.mjs';

const wasm = process.env.EMULATOR_WASM;

for (const wasi of ['node', 'shim']) {
  describe(`AWS SDK v3 through the wasm emulator (wasi: ${wasi})`, { skip: !wasm && 'EMULATOR_WASM is not set' }, () => {
    const clients = {};

    before(async () => {
      const started = performance.now();
      const emulator = await loadEmulator(wasm, { wasi });
      const config = {
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        requestHandler: new WasmRequestHandler(emulator, { responseBody: nodeResponseBody }),
        maxAttempts: 1,
      };
      clients.ddb = new DynamoDBClient(config);
      clients.s3 = new S3Client({ ...config, forcePathStyle: true });
      clients.sqs = new SQSClient(config);
      console.log(`# [${wasi}] load+instantiate: ${(performance.now() - started).toFixed(0)} ms`);
    });

    for (const [name, run] of Object.entries(scenarios)) {
      test(name, async () => {
        const timings = await run(clients);
        for (const { label, ms } of timings) console.log(`# [${wasi}] ${label}: ${ms} ms`);
        if (wasi === 'shim' && name === 'dynamodb') {
          // The virtual clock skips the 3-second CREATING wait instead of blocking on it.
          const describe = timings.find((t) => t.label === 'DescribeTable');
          assert.ok(describe.ms < 1000, `DescribeTable took ${describe.ms} ms`);
        }
      });
    }
  });
}
