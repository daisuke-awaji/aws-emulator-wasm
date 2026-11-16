// What the stack promises, checked on the synthesized template: the gate's settings reach
// the function, data stays private, and the role can do only what api/todos.js does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { TodoApiStack } from '../lib/todo-api-stack.mjs';

const app = new App();
const stack = new TodoApiStack(app, 'TodoApi', {
  env: { account: '123456789012', region: 'us-east-1' },
  allowedOrigins: ['https://example.github.io'],
  appUrls: ['https://example.github.io/app/'],
});
const template = Template.fromStack(stack);

test('the table has the key schema of api/provision.js', () => {
  template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'id', KeyType: 'RANGE' },
    ],
  });
});

test('the endpoint is ApplicationManaged and the app gets its gate settings', () => {
  template.hasResourceProperties('AWS::Lambda::WebFunctionEndpoint', { AuthType: 'ApplicationManaged' });
  const revisions = template.findResources('AWS::Lambda::WebFunctionRevision');
  const [revision] = Object.values(revisions);
  const vars = revision.Properties.ServiceConfig.EnvironmentVariables;
  for (const name of ['TABLE_NAME', 'BUCKET_NAME', 'QUEUE_URL', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'ALLOWED_ORIGINS']) {
    assert.ok(vars[name], `${name} is set`);
  }
  assert.equal(vars.ALLOWED_ORIGINS, 'https://example.github.io');
});

test('only administrators create users; the client uses the code flow without a secret', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    GenerateSecret: false,
    AllowedOAuthFlows: ['code'],
    CallbackURLs: ['https://example.github.io/app/'],
  });
});

test('the notes bucket is private and TLS-only', () => {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
  });
  template.hasResourceProperties('AWS::S3::BucketPolicy', {
    PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
  });
});

test('the API role has no wildcard actions or resources', () => {
  // The execution role of the revision (the asset-copy helper has a role of its own).
  const [revision] = Object.values(template.findResources('AWS::Lambda::WebFunctionRevision'));
  const role = revision.Properties.ServiceConfig.ExecutionRoleArn['Fn::GetAtt'][0];
  const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) => p.Properties.Roles.some((r) => r.Ref === role));
  const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  const apiStatements = statements.filter((s) => [s.Action].flat().some((a) => /^(dynamodb|s3|sqs):/.test(a)));
  assert.ok(apiStatements.length >= 4);
  for (const s of apiStatements) {
    assert.ok([s.Action].flat().every((a) => !a.endsWith('*')), JSON.stringify(s.Action));
    assert.notEqual(s.Resource, '*');
  }
});
