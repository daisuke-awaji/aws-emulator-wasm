// The CDK app: one stack, TodoApi, in the account and Region of your AWS credentials
// (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION; Lambda Web Functions must be offered there).
import { App } from 'aws-cdk-lib';
import { TodoApiStack } from '../lib/todo-api-stack.mjs';

const app = new App();
new TodoApiStack(app, 'TodoApi', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description: 'aws-emulator-wasm demo: the Todo API as a Lambda Web Function (DynamoDB, S3, SQS, Cognito)',
  allowedOrigins: app.node.tryGetContext('allowedOrigins'),
  appUrls: app.node.tryGetContext('appUrls'),
  retainData: app.node.tryGetContext('retainData') !== false && app.node.tryGetContext('retainData') !== 'false',
});
