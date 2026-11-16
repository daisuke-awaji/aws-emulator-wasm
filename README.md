<div align="center">

# aws-emulator-wasm

**AWS in a browser tab.**

[AWS Emulator](https://github.com/aws/aws-emulator) compiled to WebAssembly and run in a Web Worker.<br>
Point AWS SDK v3 at it and get DynamoDB, S3 and SQS with no server, no Docker and no AWS account.

[![CI](https://github.com/daisuke-awaji/aws-emulator-wasm/actions/workflows/wasm.yml/badge.svg)](https://github.com/daisuke-awaji/aws-emulator-wasm/actions/workflows/wasm.yml)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-000?logo=github)](https://daisuke-awaji.github.io/aws-emulator-wasm/)
![wasm32-wasip1](https://img.shields.io/badge/target-wasm32--wasip1-654ff0?logo=webassembly&logoColor=white)
![AWS SDK v3](https://img.shields.io/badge/AWS%20SDK-v3-232f3e)

[**Live demo**](https://daisuke-awaji.github.io/aws-emulator-wasm/) · [SDK round-trip tests](https://daisuke-awaji.github.io/aws-emulator-wasm/sdk.html) · [How it works](#how-it-works)

<sub>A personal hobby project. It is not an official AWS project and does not represent Amazon Web Services or Amazon.</sub>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/img/readme-dark.png">
  <img src="./docs/img/readme-light.png" alt="The Todo demo: React talks to MSW, which hands each request to a Hono API using AWS SDK v3, which calls the AWS Emulator running as wasm in a Web Worker. Todos live in DynamoDB, notes in S3 and the change log in SQS." width="900">
</picture>

</div>

## Why

A static site cannot talk to AWS, so a mock app usually needs a backend somewhere: a local stack in Docker, or a real account. That is a problem when the app was built by a remote coding agent and someone just wants to click through it.

This project moves the backend into the page. The demo is plain static files on GitHub Pages. Its API calls are caught by [MSW](https://mswjs.io/), and the handlers use the real AWS SDK v3 against an emulator inside the same tab. Share the URL, and the whole stack comes with it.

## Highlights

- **The real SDK, unchanged.** `DynamoDBClient`, `S3Client` and `SQSClient` work with one `clientConfig()`. Only the request handler is swapped: requests go to the Worker instead of the network.
- **Upstream code, not a rewrite.** The Rust emulator is built for `wasm32-wasip1` from a pinned upstream commit with a small patch set. A 280-line WASI shim runs it in browsers and Node.
- **Survives a reload.** With `persist`, the Worker saves a gzip snapshot of the wasm memory to OPFS when requests pause, and restores it before `ready`.
- **One tab owns the state.** A second tab waits and can take over (Web Locks), so two tabs never overwrite each other's data.
- **No waiting on timers.** A virtual clock skips ahead when the emulator sleeps, for example while a new DynamoDB table "becomes active".
- **Every call is visible.** `onCall` reports each request with its status and timing. The demo shows them per action: adding a todo is 6 SDK calls.

## Install

The package is not on the npm registry. Install it from a GitHub release, which has the wasm inside:

```bash
npm install https://github.com/daisuke-awaji/aws-emulator-wasm/releases/download/v0.1.0/aws-emulator-wasm-0.1.0.tgz
npm install @aws-sdk/client-dynamodb @aws-sdk/client-s3 @aws-sdk/client-sqs
```

```js
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { createEmulator } from 'aws-emulator-wasm/browser';
import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url'; // Vite

const emulator = createEmulator({ wasmUrl, persist: { name: 'my-app' } });

const ddb = new DynamoDBClient(emulator.clientConfig());
const s3 = new S3Client(emulator.clientConfig({ forcePathStyle: true }));

await ddb.send(new ListTablesCommand({}));
```

In Node: `const emulator = await loadEmulator()` from `aws-emulator-wasm/node`, then the same `clientConfig()`.

**[User guide](./js/README.md)**: other bundlers, MSW handlers, persistence and tabs, Node, the full API, limits and troubleshooting.

## The demo

[`demo/`](./demo) is a separate app that uses the package the way any app would: a Todo list whose REST API is a [Hono](https://hono.dev/) app. In the page, MSW hands each request to `app.fetch()`; the API keeps todos in DynamoDB, notes in S3 and a change log in SQS through AWS SDK v3. The SDK call log shows every request with its input and output. The UI is in English and Japanese (the switch in the header, or `?lang=en` / `?lang=ja`).

The API in [`demo/api/`](./demo/api) is written to move to AWS as it is, as a [Lambda Web Function](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html): Lambda runs the same Hono app as a plain Node.js HTTP server listening on `AWS_LAMBDA_HTTP_ENDPOINT`, with no adapter and no API Gateway. `npm run build:web-function -w demo` builds the package, and CI serves the API over HTTP against the emulator and starts the package the way Lambda does. See [demo/api/README.md](./demo/api/README.md) for how the API stays portable.

### On real AWS

[`infra/`](./infra) is a CDK app that runs the same API as a Lambda Web Function with DynamoDB, S3, SQS and Cognito sign-in. Pointing the page at it is a build setting: `npm run deploy -w infra` writes `VITE_API_URL` and the Cognito settings to `demo/.env.aws.local`, and `npm run build:aws -w demo` builds the same page against the endpoint, with sign-in and without the emulator. See [infra/README.md](./infra/README.md).

> [!NOTE]
> AWS Emulator models Lambda Web Functions (`lambdaweb`) only as a control plane: it stores functions, revisions and endpoints but runs no code (endpoints answer 501). The demo therefore runs the API in the page instead of emulating the Web Function.

## How it works

<img src="./docs/img/how-it-works.png" alt="GitHub Pages serves the page. With VITE_API_URL unset, React calls fetch('/api/todos'); the MSW Service Worker forwards it to the Hono API with AWS SDK v3, which posts it to aws-emulator.wasm in a Web Worker, where DynamoDB holds todos, S3 notes and SQS the change log, with snapshots in OPFS. With VITE_API_URL set, React sends the same requests over HTTPS with a Cognito access token to a Lambda Web Function running the same Hono API, which uses Amazon DynamoDB, S3 and SQS and verifies the token with Amazon Cognito." width="900">

<sub>Editable in draw.io: [`docs/architecture/how-it-works.drawio`](./docs/architecture/how-it-works.drawio), generated by `scripts/how_it_works.py`.</sub>

One page and one API, two places to run them. The build setting `VITE_API_URL` picks the path:

| | `VITE_API_URL` unset (the demo) | `VITE_API_URL` set |
|---|---|---|
| Who answers `fetch('/api/todos')` | MSW, in the page | A Lambda Web Function |
| The API | The Hono app in `demo/api/` | The same Hono app, as a Node HTTP server |
| DynamoDB, S3, SQS | aws-emulator.wasm in a Web Worker | The real services ([`infra/`](./infra)) |
| Users | One, in this browser | Cognito sign-in, data per user |

In the demo, everything runs in one browser tab, served as static files from GitHub Pages:

1. The app calls its own API with `fetch`. MSW catches the request in the page and hands it to the Hono app.
2. The app runs ordinary SDK code: `docs.send(new PutCommand(...))`.
3. `WasmRequestHandler` encodes the signed HTTP request and posts it to the Worker.
4. The Worker passes it to the wasm through a small C ABI. Inside, upstream's `MultiServiceRouter` dispatches it to the service, backed by the in-memory engine.
5. The response travels back the same way. After the wasm download, nothing leaves the tab.

The build includes DynamoDB, S3 and SQS plus the services they depend on, 13 in total. The optimized wasm is 26.6 MiB, or 8.8 MiB as GitHub Pages serves it (gzip).

For a file-by-file view, see the [internal architecture diagram](./docs/img/architecture.drawio.png) (editable in draw.io; generated by `scripts/architecture.py`).

## Development

Requires Node 22+. Building the wasm also needs Rust 1.100.0 with `wasm32-wasip1`, wasi-sdk 34 and about 20 GB of disk; CI does this for you.

```bash
npm ci

# Get the wasm: download the "aws-emulator-wasm" artifact from a CI run, or build it
bash scripts/fetch-upstream.sh .upstream   # pinned upstream + wasm patches
(cd .upstream && \
  CARGO_PROFILE_RELEASE_OPT_LEVEL=s \
  CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="-C link-arg=-zstack-size=8388608" \
  cargo build --release --target wasm32-wasip1 -p aws-emulator-wasm-host)

export EMULATOR_WASM=path/to/aws-emulator.opt.wasm
npm run wasm -w js                # copy the wasm to js/aws-emulator.wasm, where the package exports it
npm test -w js                    # Node: WASI shim, codec, SDK round trips, snapshots
npm run dev -w demo               # http://localhost:5173/
npm run test:api -w demo          # the API as an HTTP server, and the Web Function package's start-up
npx -w demo playwright install chromium
npm run test:e2e -w demo          # Playwright, desktop and mobile
```

C dependencies need `CC_wasm32_wasip1`, `AR_wasm32_wasip1` and `CFLAGS_wasm32_wasip1` pointed at wasi-sdk; the `wasm-opt -Oz` step and the rest are in [`.github/workflows/wasm.yml`](./.github/workflows/wasm.yml). Every push to `main` builds the wasm, runs the Node and Playwright suites, and deploys the demo to Pages.

The demo depends on the package through the npm workspace, so it always runs the code in `js/`.

### Releasing the package

1. Bump `version` in `js/package.json` and commit.
2. Push a matching tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. CI packs `js/` with the wasm (`npm pack`), installs the tarball in an empty project as a check, and attaches it to a GitHub release named after the tag.

Every CI run also uploads the tarball as the artifact `aws-emulator-wasm-package`.

### Layout

```
crates/wasm-host/   wasm entry point: router and C ABI
js/                 the aws-emulator-wasm package: WASI shim, browser and Node loaders, SDK request handler, snapshots
demo/               Vite + React + MSW Todo demo (English and Japanese), SDK test page, Playwright tests
demo/api/           the demo's Hono API: behind MSW in the page, and as a Lambda Web Function (index.js)
infra/              AWS CDK app: the API as a Lambda Web Function, with DynamoDB, S3, SQS and Cognito
scripts/            fetch and trim upstream, apply wasm patches, draw the architecture
patches/            the wasm32 patch set (P1–P4)
docs/               design notes and reports
```

## Docs

Design notes and reports are written in Japanese.

- [PLAN.md](./PLAN.md): plan, upstream survey, design decisions and risks
- [docs/persistence-design.md](./docs/persistence-design.md): persistence options, experiments and the chosen design
- [docs/phase1-report.md](./docs/phase1-report.md), [phase05](./docs/phase05-report.md), [phase0](./docs/phase0-report.md): build and porting reports
- [PROGRESS.md](./PROGRESS.md): work log

## Upstream

This repository contains no upstream code. `scripts/fetch-upstream.sh` checks out [aws/aws-emulator](https://github.com/aws/aws-emulator) at a pinned commit (`813af480`, 2026-11-14), trims it to the crates in use and applies the patches.

AWS service icons are from [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/). Other icons are from [Lucide](https://lucide.dev/) and [Simple Icons](https://simpleicons.org/).

## Disclaimer

This is a personal hobby project. It is not an official AWS project, and it does not represent the views of Amazon Web Services or Amazon. AWS and the AWS service names are trademarks of Amazon.com, Inc. or its affiliates.
