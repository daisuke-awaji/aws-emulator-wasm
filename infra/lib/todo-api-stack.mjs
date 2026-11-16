// The real resources behind demo/api: the same table, bucket and queue that
// demo/api/provision.js creates in the emulator, a Cognito user pool for sign-in, and the
// Hono app as a Lambda Web Function (demo/dist-web-function, from
// `npm run build:web-function -w demo`).
//
// The endpoint is ApplicationManaged because the browser calls it directly and cannot
// sign SigV4; the app is the gate (api/server.js): a Cognito access token from this pool
// and app client on every /api request, and CORS for the configured origins only.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export const PACKAGE_DIR = resolve(import.meta.dirname, '../../demo/dist-web-function');

export class TodoApiStack extends Stack {
  /**
   * @param {import('constructs').Construct} scope
   * @param {string} id
   * @param {import('aws-cdk-lib').StackProps & {
   *   allowedOrigins: string[],
   *   appUrls: string[],
   *   retainData?: boolean,
   *   packageDir?: string,
   * }} props
   *   allowedOrigins: origins the browser may call the API from (CORS), e.g. https://<user>.github.io
   *   appUrls: the page URLs Cognito may send users back to after sign-in and sign-out
   *   retainData: keep the table, bucket and user pool when the stack is deleted (default true)
   */
  constructor(scope, id, props) {
    super(scope, id, props);
    const { allowedOrigins, appUrls, retainData = true, packageDir = PACKAGE_DIR } = props;
    if (!allowedOrigins?.length) throw new Error('allowedOrigins is required (cdk.json context)');
    if (!appUrls?.length) throw new Error('appUrls is required (cdk.json context)');
    if (!existsSync(resolve(packageDir, 'index.js'))) {
      throw new Error(`${packageDir}/index.js is missing: run npm run build:web-function -w demo`);
    }
    const dataPolicy = retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // --- Data: the same shapes as api/provision.js -----------------------------------------
    const table = new dynamodb.TableV2(this, 'Todos', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: dataPolicy,
    });

    const notes = new s3.Bucket(this, 'Notes', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: dataPolicy,
      autoDeleteObjects: !retainData,
    });

    const activity = new sqs.Queue(this, 'Activity', {
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(1),
      visibilityTimeout: Duration.seconds(30),
    });

    // --- Sign-in --------------------------------------------------------------------------
    // No self sign-up: only users an administrator creates can sign in (see infra/README.md).
    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: false },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      removalPolicy: dataPolicy,
    });
    const domain = users.addDomain('Domain', {
      // Must be unique in the Region and may not contain "aws", "amazon" or "cognito".
      cognitoDomain: { domainPrefix: `todo-demo-${this.account}` },
    });
    const client = users.addClient('Web', {
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
    });

    // --- The API ----------------------------------------------------------------------------
    const api = new lambda.WebFunction(this, 'Api', {
      code: lambda.WebFunctionCode.fromAssetToManagedBucket(packageDir),
      runtime: lambda.WebFunctionRuntime.NODEJS_24_X,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: notes.bucketName,
        QUEUE_URL: activity.queueUrl,
        COGNITO_USER_POOL_ID: users.userPoolId,
        COGNITO_CLIENT_ID: client.userPoolClientId,
        ALLOWED_ORIGINS: allowedOrigins.join(','),
      },
      defaultEndpointAuth: lambda.WebFunctionAuthType.APPLICATION_MANAGED,
      defaultEndpoint: {
        endpointDescription: 'Todo API (Cognito access token checked by the app)',
        // A demo: cap what a burst can cost.
        maxEnvironments: 2,
        rateLimit: 100,
      },
    });

    // Deliberate: the app verifies a Cognito access token on every /api request
    // (demo/api/server.js, covered by demo/api/test/server.test.mjs).
    Annotations.of(api.endpoint).acknowledgeWarning(
      '@aws-cdk/aws-lambda:webFunctionPublicEndpoint',
      'The app checks a Cognito access token on every /api request',
    );

    // Exactly what api/todos.js calls, on these resources only.
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: [table.tableArn],
    }));
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [notes.arnForObjects('notes/*')],
    }));
    // Without ListBucket a missing note is AccessDenied instead of NoSuchKey.
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [notes.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['notes/*'] } },
    }));
    api.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility'],
      resources: [activity.queueArn],
    }));

    // --- What the page needs (scripts/write-env.mjs turns these into demo/.env.aws.local) ---
    const out = (name, value, description) => new CfnOutput(this, name, { value, description });
    out('ApiUrl', `https://${api.endpoint.domainName}`, 'VITE_API_URL');
    out('CognitoAuthority', `https://cognito-idp.${this.region}.amazonaws.com/${users.userPoolId}`, 'VITE_COGNITO_AUTHORITY');
    out('CognitoClientId', client.userPoolClientId, 'VITE_COGNITO_CLIENT_ID');
    out('CognitoDomain', domain.baseUrl(), 'VITE_COGNITO_DOMAIN');
    out('UserPoolId', users.userPoolId, 'for aws cognito-idp admin-create-user');
    out('TableName', table.tableName, 'DynamoDB table');
  }
}
