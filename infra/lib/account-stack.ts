import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as budgets from 'aws-cdk-lib/aws-budgets'
import * as iam from 'aws-cdk-lib/aws-iam'
import { ACCOUNT, CONFIG, type EnvName } from '../config'

/**
 * Account-wide pieces, shared by both environments. Deployed ONCE, by hand,
 * from a laptop with admin credentials — never from CI, because it defines
 * the very roles CI runs as.
 *
 *   npx cdk deploy Oasi-Account
 *
 * Contains:
 *   - GitHub's OIDC identity provider, so GitHub Actions gets short-lived AWS
 *     credentials per run instead of long-lived access keys stored in GitHub.
 *   - One deploy role per environment. Each can only be assumed by a workflow
 *     job running in the matching GitHub Environment of this repo, so a job
 *     for `dev` can never deploy `prod`.
 *   - A monthly cost budget that emails when spend approaches the limit.
 */
export class AccountStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const provider = new iam.OidcProviderNative(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    })

    for (const stage of Object.keys(CONFIG) as EnvName[]) {
      const role = new iam.Role(this, `DeployRole-${stage}`, {
        roleName: `oasi-github-deploy-${stage}`,
        description: `GitHub Actions deploys OASI ${stage} (${ACCOUNT.githubOrg}/${ACCOUNT.githubRepo}, environment ${stage})`,
        maxSessionDuration: cdk.Duration.hours(1),
        assumedBy: new iam.FederatedPrincipal(
          provider.oidcProviderArn,
          {
            StringEquals: {
              'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              // A job only gets this subject when it declares
              // `environment: <stage>`. That is what ties the role to the
              // environment (and its protection rules), not to a branch name
              // anyone could push.
              'token.actions.githubusercontent.com:sub':
                `repo:${ACCOUNT.githubOrg}/${ACCOUNT.githubRepo}:environment:${stage}`,
            },
          },
          'sts:AssumeRoleWithWebIdentity',
        ),
      })

      // Least privilege for CDK v2: the role does not create resources itself,
      // it only assumes the roles `cdk bootstrap` already made (deploy, asset
      // publishing, lookups). CloudFormation does the rest with those.
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-${this.region}`],
        }),
      )

      // After deploying, the workflow runs the database migrations through
      // this environment's db-ops Lambda (see lib/api-stack.ts). Note it is
      // NOT allowed to invoke oasi-db-bootstrap: that one holds the master
      // credentials and can reach both environments, so it stays manual.
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [`arn:aws:lambda:${this.region}:${this.account}:function:oasi-db-ops-${stage}`],
        }),
      )

      new cdk.CfnOutput(this, `DeployRoleArn-${stage}`, {
        value: role.roleArn,
        description: `GitHub → Settings → Environments → ${stage} → secret AWS_DEPLOY_ROLE_ARN`,
      })
    }

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'oasi-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: ACCOUNT.monthlyBudgetUsd, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          // Real spend already past 80% of the limit.
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: ACCOUNT.budgetEmail }],
        },
        {
          // AWS projects the month will end over the limit — the early warning.
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: ACCOUNT.budgetEmail }],
        },
      ],
    })
  }
}
