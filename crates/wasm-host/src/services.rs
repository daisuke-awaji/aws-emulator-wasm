// The services this build serves: DynamoDB and SQS plus every service they depend on.
// Keep in step with Cargo.toml.

macro_rules! mount {
    ($router:ident, $engine:ident, $krate:ident) => {{
        // One frame per service: an EmulatedService::new frame is large, and holding
        // several at once overflows the stack (see upstream core/router/src/lib.rs).
        #[inline(never)]
        fn one(
            router: &mut smithy_server_runtime::MultiServiceRouter,
            engine: &std::sync::Arc<engine::InMemoryEngine>,
        ) {
            router.register_service($krate::EmulatedService::new(engine.clone()));
        }
        one(&mut $router, &$engine);
    }};
}

pub(crate) fn build_router(
    engine: std::sync::Arc<engine::InMemoryEngine>,
) -> smithy_server_runtime::MultiServiceRouter {
    let mut router = smithy_server_runtime::MultiServiceRouter::new();
    mount!(router, engine, service_com_amazonaws_cloudhsmv2_baldrapiservice);
    mount!(router, engine, service_com_amazonaws_cloudwatch_graniteserviceversion20100801);
    mount!(router, engine, service_com_amazonaws_cognitoidentityprovider_awscognitoidentityproviderservice);
    mount!(router, engine, service_com_amazonaws_dynamodb_dynamodb_20120810);
    mount!(router, engine, service_com_amazonaws_dynamodbstreams_dynamodbstreams_20120810);
    mount!(router, engine, service_com_amazonaws_iam_awsidentitymanagementv20100508);
    mount!(router, engine, service_com_amazonaws_kinesis_kinesis_20131202);
    mount!(router, engine, service_com_amazonaws_kms_trentservice);
    mount!(router, engine, service_com_amazonaws_s3_amazons3);
    mount!(router, engine, service_com_amazonaws_s3tables_s3tablebuckets);
    mount!(router, engine, service_com_amazonaws_sqs_amazonsqs);
    mount!(router, engine, service_com_amazonaws_sts_awssecuritytokenservicev20110615);
    mount!(router, engine, service_com_amazonaws_wafv2_awswaf_20190729);
    router
}
