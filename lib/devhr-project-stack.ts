import * as cdk from "@aws-cdk/core";
import s3 = require("@aws-cdk/aws-s3");
import lambda = require("@aws-cdk/aws-lambda");
import dynamodb = require("@aws-cdk/aws-dynamodb");
import { Duration } from "@aws-cdk/core";
import iam = require("@aws-cdk/aws-iam");
import event_sources = require("@aws-cdk/aws-lambda-event-sources");

const imageBucketName = "cdk-rekn-imagebucket";
const resizedBucketName = `${imageBucketName}-resized`;

export class DevhrProjectStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imageBucket = new s3.Bucket(this, imageBucketName, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, "imageBucket", { value: imageBucket.bucketName });

    const resizedBucket = new s3.Bucket(this, resizedBucketName, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, "resizedBucket", {
      value: resizedBucket.bucketName,
    });

    const table = new dynamodb.Table(this, "ImageLabels", {
      partitionKey: { name: "image", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, "ddbTable", { value: table.tableName });

    const layer = new lambda.LayerVersion(this, "jimps", {
      code: lambda.Code.fromAsset("layer/nodejs"),
      compatibleRuntimes: [lambda.Runtime.NODEJS_12_X],
      license: "Apache-2.0",
      description:
        "A layer to enable the JIMPS library in our Rekognition Lambda",
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
    imageBucket.grantRead(serviceFn);
    resizedBucket.grantPut(serviceFn);
    table.grantReadWriteData(serviceFn);
  }
}
