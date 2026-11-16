// Writes demo/.env.aws.local from the stack outputs (cdk-outputs.json, written by
// `npm run deploy`). With it, `npm run dev:aws -w demo` and `npm run build:aws -w demo`
// build the page against the deployed API: the only thing that changes is where it calls.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputs = JSON.parse(readFileSync(resolve(import.meta.dirname, '../cdk-outputs.json'), 'utf8')).TodoApi;
if (!outputs) throw new Error('cdk-outputs.json has no TodoApi stack: run npm run deploy');
const env = {
  VITE_API_URL: outputs.ApiUrl,
  VITE_COGNITO_AUTHORITY: outputs.CognitoAuthority,
  VITE_COGNITO_CLIENT_ID: outputs.CognitoClientId,
  VITE_COGNITO_DOMAIN: outputs.CognitoDomain,
};
for (const [k, v] of Object.entries(env)) if (!v) throw new Error(`stack output for ${k} is missing`);
const file = resolve(import.meta.dirname, '../../demo/.env.aws.local');
writeFileSync(file, `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
console.log(`wrote demo/.env.aws.local\n${Object.entries(env).map(([k, v]) => `  ${k}=${v}`).join('\n')}`);
