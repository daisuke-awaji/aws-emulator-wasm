# The Todo API: in the browser now, a Lambda Web Function later

This directory is the demo's whole backend: a [Hono](https://hono.dev/) app over AWS SDK v3. It knows nothing about the browser, MSW or the emulator. The same files run in two places:

```
browser (the demo)                         AWS (production)
fetch('/api/todos')                        HTTPS request to the Web Function endpoint
  → MSW (src/mocks/handlers.js)              → Lambda Web Functions: plain HTTP/1.1 to your server
  → app.fetch(request)                       → index.js: Node HTTP server → app.fetch(request)
  → api/todos.js → AWS SDK v3                → api/todos.js → AWS SDK v3
  → aws-emulator-wasm (Web Worker)           → DynamoDB, S3, SQS
```

[Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html) run an ordinary Node.js HTTP server: Lambda starts `index.js` at the root of the package, the server listens on the address in `AWS_LAMBDA_HTTP_ENDPOINT`, and each request arrives as plain HTTP/1.1 behind Lambda's own HTTPS endpoint. There is no event object, no Lambda adapter and no API Gateway.

| File | Role | Runs in |
|---|---|---|
| `app.js` | Routes and error responses: `createApp({ docs, s3, sqs, table, bucket, queueUrl })` | both |
| `todos.js` | The SDK calls: list, create, update, delete, notes, change log | both |
| `errors.js` | `ApiError`: `{ code, message, ...params }` bodies | both |
| `server.js` | The app with clients and names from the environment, and `listen()` on `AWS_LAMBDA_HTTP_ENDPOINT` | AWS, local Node |
| `index.js` | The package's entry point: starts the server, exits on `SIGTERM` | AWS, local Node |
| `provision.js` | Creates the table, bucket and queue, and seed data | emulator only |
| `test/server.test.mjs` | The server over real HTTP against the emulator in Node, and the built package started as Lambda starts it | Node |

## Rules that keep it portable

- **Everything environment-specific comes in through `createApp()`.** The SDK clients and the resource names are arguments. The browser passes emulator clients (`src/backend.js`); the Web Function passes default clients and names from environment variables (`server.js`).
- **Only web-standard and SDK APIs in the app.** `app.js` and `todos.js` use no `fs`, `process.env` or Node streams. Hono, `crypto.randomUUID()`, `Request` and `Response` exist in both places. Node-only code (`@hono/node-server`, environment variables) stays in `server.js` and `index.js`.
- **Resources are created by infrastructure, not by the API.** `provision.js` is for an empty emulator only. In AWS, create the table, bucket and queue in CDK, CloudFormation or Terraform and pass their names in.
- **Safe for concurrent requests.** One execution environment serves many requests at once (`maxConcurrencyPerEnvironment`, default 64), so the app keeps no per-request state in module variables; the clients are created once per process.
- **Errors carry a code.** The API answers `{ code: 'TITLE_REQUIRED', message: 'Enter a title' }`, and the page translates the code. An unexpected error is `500 { code: 'INTERNAL' }` and is logged with the `lambda-web-request-id` header. Only the browser demo includes the error's text (`exposeErrors: true`).

## Running it locally as a server

```bash
TABLE_NAME=todos BUCKET_NAME=todo-notes QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/todo-activity \
  npm run start:api -w demo      # listens on localhost:3000 (AWS_LAMBDA_HTTP_ENDPOINT overrides it)
```

This talks to the AWS account in your credentials. The emulator does not serve HTTP in Node, so to exercise the server without AWS use the test below.

## Deploying it as a Lambda Web Function

### 1. Build the package

```bash
npm run build:web-function -w demo      # → demo/dist-web-function/{index.js, package.json}
cd demo/dist-web-function && zip -r ../web-function.zip . && cd -
```

`index.js` is the server with Hono, `@hono/node-server` and the AWS SDK bundled in (about 800 KiB). `package.json` only says `"type": "module"`. The package has no native dependencies, so the Arm64 environment needs nothing extra.

### 2. Resources and environment

Upload the zip to a versioned S3 bucket that Lambda can read (see [Deploying Web Function code from Amazon S3](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.html)), and create the resources the API uses:

| Variable (revision `serviceConfig.environmentVariables`) | Value |
|---|---|
| `TABLE_NAME` | A DynamoDB table with partition key `id` (string), on-demand capacity |
| `BUCKET_NAME` | An S3 bucket for notes (`notes/<id>.txt`) |
| `QUEUE_URL` | An SQS standard queue for the change log |

Do not set `AWS_LAMBDA_HTTP_ENDPOINT`, `AWS_REGION` or credentials: Lambda sets them. The execution role needs:

| Service | Actions | Resource |
|---|---|---|
| DynamoDB | `Scan`, `PutItem`, `UpdateItem`, `DeleteItem` | the table |
| S3 | `GetObject`, `PutObject`, `DeleteObject` | `arn:aws:s3:::<bucket>/notes/*` |
| S3 | `ListBucket` | the bucket (without it, a missing note is 403 instead of `NoSuchKey`, which the API treats as an empty note) |
| SQS | `SendMessage`, `ReceiveMessage`, `DeleteMessage` | the queue |
| CloudWatch Logs | as the default Web Function role | `/aws/lambda/web/<function>` |

### 3. Create the function and an endpoint

```bash
aws lambda-web create-web-function \
  --function-name todo-api \
  --revision-config '{
    "buildConfig": {
      "codeConfig": { "s3Object": { "bucket": "<deploy-bucket>", "key": "web-function.zip" } },
      "runtimeConfig": { "runtime": "nodejs24.x" }
    },
    "serviceConfig": {
      "executionRoleArn": "arn:aws:iam::<account>:role/todo-api",
      "environmentVariables": { "TABLE_NAME": "…", "BUCKET_NAME": "…", "QUEUE_URL": "…" }
    }
  }' \
  --endpoint-config '{
    "endpointName": "prod",
    "endpointType": "HomeRegion",
    "authType": "IamAuth",
    "autoDeploymentMode": "LatestRevision"
  }'
```

Or let `aws lambda-web deploy --name todo-api --code demo/dist-web-function` create the bucket, role, revision and endpoint for you; pass the environment variables on the revision either way. The endpoint's `domainName` serves the same paths as the demo (`/api/todos`, …). To serve the front end and the API from one origin, or to add a custom domain or AWS WAF, put CloudFront in front and route `/api/*` to the endpoint.

> [!IMPORTANT]
> This demo API has no authentication: anyone who can reach it can read and change every Todo. Keep the endpoint on `IamAuth` (Lambda rejects requests that are not signed with SigV4 by an allowed principal) until the app checks users itself. `ApplicationManaged` forwards every request to the app, so choose it only once the app authenticates requests, for example with a JWT middleware in Hono.

### Differences you will meet in AWS

- **The change log is shared.** `GET /api/activity` drains the queue, so two users would take each other's events. It suits the single-user demo; a real app would use a per-user feed or DynamoDB Streams.
- **Scan reads the whole table.** Fine for a demo; a real app would query by user.
- **Timing is real.** The emulator in the browser skips waits with a virtual clock; AWS does not.

## Why the demo does not emulate the Web Function itself

AWS Emulator models Lambda Web Functions (`lambdaweb`) only as a control plane: it stores functions, revisions and endpoints, but runs no code, and its endpoints answer 501. It also opens a TCP listener per endpoint, which a browser cannot do. Running the same Hono app behind MSW gives the page the same HTTP contract without any of that.

## Testing

```bash
npm run wasm -w js                   # once: put the emulator wasm in js/
npm run build:web-function -w demo   # the package, for the last test
npm run test:api -w demo             # the server over HTTP against the emulator, and the package's start-up
npm run test:e2e -w demo             # the page, with the same app behind MSW
```
