import { Construct, Stage, StageProps } from "@aws-cdk/core";
import { DevhrProjectStack } from "./devhr-project-stack";

/**
 * Deployable unit of awsdevhour-backend app
 * */
export class AwsdevhourBackendPipelineStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props);

    new DevhrProjectStack(this, "AwsdevhourBackendStack-dev");
  }
}
