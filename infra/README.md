# infra: the demo on real AWS

An AWS CDK app (JavaScript) with everything the demo's API needs in AWS. The page and the API code are the ones the in-browser demo runs; switching from the emulator to AWS is a build setting of the page.

```
GitHub Pages (or localhost)                 AWS (one stack: TodoApi)
  the same React page, built with             Cognito user pool ── sign-in page (code + PKCE)
  VITE_API_URL=<endpoint>   ── HTTPS ──▶       Lambda Web Function: demo/api (Hono, Node 24)
  + Cognito access token                         ├─ DynamoDB table   (userId, id)
                                                 ├─ S3 bucket        notes/<userId>/<id>.txt
                                                 └─ SQS queue        change log
```

| Resource | Settings |
|---|---|
| Lambda Web Function | `demo/dist-web-function` (built by `npm run build:web-function -w demo`), `nodejs24.x`, 10 s timeout. Endpoint: home Region, `ApplicationManaged`, at most 2 environments and 100 requests per second. |
| DynamoDB | On-demand, key `(userId, id)`, point-in-time recovery |
| S3 | Block Public Access, SSE-S3, TLS only, bucket-owner objects |
| SQS | SSE-SQS, TLS only, 1-day retention |
| Cognito | No self sign-up (administrators create users), email sign-in, app client without a secret, authorization code flow, 1-hour access tokens |
| Execution role | `dynamodb:Query/PutItem/UpdateItem/DeleteItem` on the table, `s3:Get/Put/DeleteObject` on `notes/*`, `s3:ListBucket` for `notes/*`, `sqs:Send/Receive/DeleteMessage/ChangeMessageVisibility` on the queue |

## How the API is protected

The browser calls the endpoint directly and cannot sign requests with SigV4, so the endpoint is `ApplicationManaged` and the app is the gate (`demo/api/server.js`):

- Every `/api` request needs `Authorization: Bearer <access token>`, checked with [aws-jwt-verify](https://github.com/awslabs/aws-jwt-verify) against this user pool and app client. Anything else gets `401` with `WWW-Authenticate: Bearer`.
- The user is the token's `sub`. Todos, notes and change events belong to that user only.
- CORS admits the origins in `allowedOrigins` only.
- If any of these settings is missing, the server does not start.

## Deploy

Requirements: Node 22+, AWS credentials for the target account, and a CDK bootstrap in a Region that offers Lambda Web Functions (this was tested in `us-east-1`).

1. Set where the page will run in [`cdk.json`](./cdk.json):

   | Context | Meaning | Default |
   |---|---|---|
   | `allowedOrigins` | Origins the page is served from (CORS) | `http://localhost:5173`, `https://daisuke-awaji.github.io` |
   | `appUrls` | Page URLs Cognito may return to after sign-in and sign-out | `http://localhost:5173/`, `https://daisuke-awaji.github.io/aws-emulator-wasm/` |
   | `retainData` | Keep the table, bucket and user pool when the stack is deleted | `true` |

2. Deploy. This builds the API package, deploys, and writes `demo/.env.aws.local` from the stack outputs:

   ```bash
   npx cdk bootstrap aws://<account>/us-east-1      # once per account and Region
   AWS_REGION=us-east-1 npm run deploy -w infra
   ```

3. Create a user (there is no self sign-up):

   ```bash
   aws cognito-idp admin-create-user --region us-east-1 \
     --user-pool-id <UserPoolId output> --username you@example.com \
     --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true
   ```

   Cognito emails a temporary password; the sign-in page asks for a new one.

## Point the page at AWS

The only change is the build setting `demo/.env.aws.local` (written by the deploy):

```
VITE_API_URL=https://<id>.<cell>.lambda-web.us-east-1.on.aws
VITE_COGNITO_AUTHORITY=https://cognito-idp.us-east-1.amazonaws.com/<user pool id>
VITE_COGNITO_CLIENT_ID=<app client id>
VITE_COGNITO_DOMAIN=https://todo-demo-<account>.auth.us-east-1.amazoncognito.com
```

```bash
npm run dev:aws -w demo        # http://localhost:5173/, against the deployed API
BASE_PATH=/aws-emulator-wasm/ npm run build:aws -w demo   # demo/dist for GitHub Pages
```

With `VITE_API_URL` set, the build leaves out MSW, the emulator, the wasm and the SDK test page; the page sends the same requests to the endpoint with the user's token, and shows a sign-in step and an AWS panel instead of the emulator panels. Without it, the page is the in-browser demo, as before.

## Check a deployment

```bash
AWS_REGION=us-east-1 node infra/scripts/smoke.mjs   # page on http://localhost:5173/ (npm run dev:aws -w demo)
```

The smoke test checks that an anonymous request is refused, creates a temporary user, signs in on the Cognito page, adds, completes, notes and deletes a todo, signs out, and deletes the user.

`npm test -w infra` checks the synthesized template (key schema, gate settings, private bucket, no wildcard permissions).

## Remove

```bash
AWS_REGION=us-east-1 npm run destroy -w infra
```

With `retainData: true` the table, bucket and user pool stay behind; delete them in the console, or deploy with `retainData: false` first.
