import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as cognito from 'aws-cdk-lib/aws-cognito'

export interface AuthStackProps extends cdk.StackProps {
  stage: string
}

/**
 * Cognito, on its own stack.
 *
 * Split out from the main stack for one practical reason: this is the only
 * piece that is free (50k monthly active users) and the only one needed to
 * develop and test the login. The main stack contains a NAT gateway (~US$32
 * a month, not free tier), so keeping auth separate means you can deploy
 * this alone, wire up sign-in, and only pay once the API actually goes up.
 *
 *   npx cdk deploy Oasi-Auth-dev -c stage=dev     # free
 *   npx cdk deploy Oasi-dev      -c stage=dev     # starts costing
 */
export class AuthStack extends cdk.Stack {
  readonly userPool: cognito.UserPool
  readonly userPoolClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    const isProd = props.stage === 'prod'

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `oasi-${props.stage}`,
      // Internal system: an admin creates every account, never self-service.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // Default (Cognito) email sending is capped at 50 messages/day, which
      // covers invitations and password resets for a ~20-person team without
      // bringing SES into the picture.
      email: cognito.UserPoolEmail.withCognito(),
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // One group per app role. The backend reads it from the JWT, but the
    // `usuarios` table is authoritative because that is where the scope
    // (which company / agency / region) lives.
    for (const rol of ['admin', 'oasi', 'organismo', 'empresa', 'region']) {
      new cognito.CfnUserPoolGroup(this, `Group-${rol}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: rol,
        description: `OASI role: ${rol}`,
      })
    }

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `oasi-${props.stage}-web`,
      // SRP: the password never travels, the browser proves it knows it.
      authFlows: { userSrp: true },
      // SPA: no client secret, a browser cannot keep one.
      generateSecret: false,
      accessTokenValidity: cdk.Duration.hours(8),
      idTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    })

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID',
      exportName: `Oasi-${props.stage}-UserPoolId`,
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
      exportName: `Oasi-${props.stage}-UserPoolClientId`,
    })
    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'VITE_COGNITO_REGION',
    })
  }
}
