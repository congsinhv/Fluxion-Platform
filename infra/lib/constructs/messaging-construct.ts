import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

/**
 * Two-queue topology (one per consumer).
 *
 * A single queue + `target_service` body filter does NOT work with Lambda
 * SQS event-source filtering: when two ESMs share a queue, the non-matching
 * ESM treats the message as "processed" and deletes it before the matching
 * ESM can pick it up. Separate queues eliminate the race.
 */
export class MessagingConstruct extends Construct {
  readonly processorQueue: sqs.Queue;
  readonly checkinQueue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, "ActionDispatchDlq", {
      queueName: "fluxion-action-dispatch-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    this.processorQueue = new sqs.Queue(this, "ProcessorQueue", {
      queueName: "fluxion-action-processor",
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    this.checkinQueue = new sqs.Queue(this, "CheckinQueue", {
      queueName: "fluxion-action-checkin",
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    new cdk.CfnOutput(this, "ProcessorQueueUrl", {
      value: this.processorQueue.queueUrl,
      exportName: "FluxionProcessorQueueUrl",
    });
    new cdk.CfnOutput(this, "CheckinQueueUrl", {
      value: this.checkinQueue.queueUrl,
      exportName: "FluxionCheckinQueueUrl",
    });
    new cdk.CfnOutput(this, "ActionDispatchDlqUrl", {
      value: this.deadLetterQueue.queueUrl,
      exportName: "FluxionActionDispatchDlqUrl",
    });
  }
}
