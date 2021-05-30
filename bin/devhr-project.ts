#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { DevhrProjectStack } from "../lib/devhr-project-stack";
import { AwsdevhourBackendPipelineStack } from "../lib/devhr-pipeline-stack";

const app = new cdk.App();
new DevhrProjectStack(app, "DevhrProjectStack");
new AwsdevhourBackendPipelineStack(app, "AwsdevhourBackendPipelineStack");
