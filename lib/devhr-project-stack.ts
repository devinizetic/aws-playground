import {
  Stack,
  Construct,
  StackProps,
  RemovalPolicy,
  CfnOutput,
} from "@aws-cdk/core";
import s3 = require("@aws-cdk/aws-s3");
import lambda = require("@aws-cdk/aws-lambda");
import dynamodb = require("@aws-cdk/aws-dynamodb");
import { Duration } from "@aws-cdk/core";
import iam = require("@aws-cdk/aws-iam");
import event_sources = require("@aws-cdk/aws-lambda-event-sources");
import apigw = require("@aws-cdk/aws-apigateway");
import { PassthroughBehavior } from "@aws-cdk/aws-apigateway";

const imageBucketName = "cdk-rekn-imagebucket";
const resizedBucketName = `${imageBucketName}-resized`;

export class DevhrProjectStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const imageBucket = new s3.Bucket(this, imageBucketName, {
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "imageBucket", { value: imageBucket.bucketName });

    const resizedBucket = new s3.Bucket(this, resizedBucketName, {
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "resizedBucket", {
      value: resizedBucket.bucketName,
    });

    const table = new dynamodb.Table(this, "ImageLabels", {
      partitionKey: { name: "image", type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CfnOutput(this, "ddbTable", { value: table.tableName });

    const layer = new lambda.LayerVersion(this, "jimp", {
      code: lambda.Code.fromAsset("dependencies"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_12_X],
      license: "Apache-2.0",
      description:
        "A layer to enable the JIMP library in our Rekognition Lambda",
    });

    const rekFn = new lambda.Function(this, "rekognitionFunction", {
      code: lambda.Code.fromAsset("rekognition-lambda"),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      timeout: Duration.seconds(30),
      memorySize: 1024,
      layers: [layer],
      environment: {
        TABLE: table.tableName,
        BUCKET: imageBucket.bucketName,
        THUMBBUCKET: resizedBucket.bucketName,
      },
    });
    rekFn.addEventSource(
      new event_sources.S3EventSource(imageBucket, {
        events: [s3.EventType.OBJECT_CREATED],
      })
    );
    imageBucket.grantRead(rekFn);
    table.grantWriteData(rekFn);
    resizedBucket.grantPut(rekFn);

    rekFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["rekognition:DetectLabels"],
        resources: ["*"],
      })
    );

    //Service lambda

    const serviceFn = new lambda.Function(this, "serviceFunction", {
      code: lambda.Code.fromAsset("service-lambda"),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      environment: {
        TABLE: table.tableName,
        BUCKET: imageBucket.bucketName,
        THUMBBUCKET: resizedBucket.bucketName,
      },
    });
    imageBucket.grantWrite(serviceFn);
    resizedBucket.grantWrite(serviceFn);
    table.grantReadWriteData(serviceFn);

    const api = new apigw.LambdaRestApi(this, "imageAPI", {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
      },
      handler: serviceFn,
      proxy: false,
    });

    const lambdaIntegration = new apigw.LambdaIntegration(serviceFn, {
      proxy: false,
      requestParameters: {
        "integration.request.querystring.action":
          "method.request.querystring.action",
        "integration.request.querystring.key": "method.request.querystring.key",
      },
      requestTemplates: {
        "application/json": JSON.stringify({
          action: "$util.escapeJavaScript($input.params('action'))",
          key: "$util.escapeJavaScript($input.params('key'))",
        }),
      },
      passthroughBehavior: PassthroughBehavior.WHEN_NO_TEMPLATES,
      integrationResponses: [
        {
          statusCode: "200",
          responseParameters: {
            // We can map response parameters
            // - Destination parameters (the key) are the response parameters (used in mappings)
            // - Source parameters (the value) are the integration response parameters or expressions
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
        },
        {
          // For errors, we check if the error message is not empty, get the error data
          selectionPattern: "(\n|.)+",
          statusCode: "500",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": "'*'",
          },
        },
      ],
    });

    // =====================================================================================
    // API Gateway
    // =====================================================================================
    const imageAPI = api.root.addResource("images");

    // GET /images
    imageAPI.addMethod("GET", lambdaIntegration, {
      requestParameters: {
        "method.request.querystring.action": true,
        "method.request.querystring.key": true,
      },
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        {
          statusCode: "500",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });

    // DELETE /images
    imageAPI.addMethod("DELETE", lambdaIntegration, {
      requestParameters: {
        "method.request.querystring.action": true,
        "method.request.querystring.key": true,
      },
      methodResponses: [
        {
          statusCode: "200",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
        {
          statusCode: "500",
          responseParameters: {
            "method.response.header.Access-Control-Allow-Origin": true,
          },
        },
      ],
    });
  }
}
