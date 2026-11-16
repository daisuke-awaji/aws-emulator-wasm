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
| `server.js` | The app with clients, names and the Cognito gate from the environment, CORS, and `listen()` on `AWS_LAMBDA_HTTP_ENDPOINT` | AWS, local Node |
| `index.js` | The package's entry point: starts the server, exits on `SIGTERM` | AWS, local Node |
| `provision.js` | Creates the table, bucket and queue, and seed data | emulator only |
| `test/server.test.mjs` | The server over real HTTP against the emulator in Node (gate, per-user data, CORS), and the built package started as Lambda starts it | Node |

## Rules that keep it portable

- **Everything environment-specific comes in through `createApp()`.** The SDK clients and the resource names are arguments. The browser passes emulator clients (`src/backend.js`); the Web Function passes default clients and names from environment variables (`server.js`).
- **Only web-standard and SDK APIs in the app.** `app.js` and `todos.js` use no `fs`, `process.env` or Node streams. Hono, `crypto.randomUUID()`, `Request` and `Response` exist in both places. Node-only code (`@hono/node-server`, environment variables) stays in `server.js` and `index.js`.
- **Resources are created by infrastructure, not by the API.** `provision.js` is for an empty emulator only. In AWS the CDK stack in `infra/` creates the same table, bucket and queue and passes their names in.
- **Safe for concurrent requests.** One execution environment serves many requests at once (`maxConcurrencyPerEnvironment`, default 64), so the app keeps no per-request state in module variables; the clients are created once per process.
- **Errors carry a code.** The API answers `{ code: 'TITLE_REQUIRED', message: 'Enter a title' }`, and the page translates the code. An unexpected error is `500 { code: 'INTERNAL' }` and is logged with the `lambda-web-request-id` header. Only the browser demo includes the error's text (`exposeErrors: true`).

## Who may call it

Every route needs a user. `createApp({ authenticate })` takes a function that returns the caller's user id or throws a 401, and there is no default:

| Where | `authenticate` |
|---|---|
| The page (`src/backend.js`) | Always `local-user`: the data never leaves the browser |
| The Web Function (`server.js`) | `Authorization: Bearer <Cognito access token>`, verified with aws-jwt-verify against `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`; anything else is `401` with `WWW-Authenticate: Bearer` |

Data is keyed by user: the table by `(userId, id)`, notes under `notes/<userId>/`, and change events carry the user so each drain takes only its own. The server also answers CORS for `ALLOWED_ORIGINS` only, and refuses to start if any of these settings is missing.

## Running it on AWS

[`infra/`](../../infra) is a CDK app with the table, bucket, queue, Cognito user pool and this package as a Lambda Web Function. `npm run deploy -w infra` deploys it and writes the page's build settings; [infra/README.md](../../infra/README.md) has the steps, the resources and the permissions.

| Environment (set by the stack) | Value |
|---|---|
| `TABLE_NAME`, `BUCKET_NAME`, `QUEUE_URL` | The resources |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | Whose access tokens are accepted |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS |

Lambda sets `AWS_LAMBDA_HTTP_ENDPOINT`, `AWS_REGION` and the credentials. Locally, `npm run start:api -w demo` with the same variables listens on `127.0.0.1:3000` against the account in your credentials.

### Differences you will meet in AWS

- **The change log queue is shared.** A drain deletes the caller's events and makes other users' events visible again at once. That is fine for a demo; at scale, use a per-user feed or DynamoDB Streams.
- **SQS short polling can miss a waiting message**, so the first receive of a drain long-polls for up to 1 second.
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
