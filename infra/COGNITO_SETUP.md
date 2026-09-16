# Cognito setup

Step-by-step to get login working. **Nothing here costs money**: Cognito is
free up to 50,000 monthly active users, and this stack deliberately leaves out
everything that is not (see "What this does NOT create" at the end).

---

## 0. AWS credentials (first time only)

`cdk bootstrap` failing with *"Unable to resolve AWS account to use"* means the
CLI has no credentials yet, or `AWS_PROFILE` is not exported in that shell.

Install the CLI:

```bash
curl -sS "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -q awscliv2.zip && sudo ./aws/install --update && rm -rf awscliv2.zip aws
```

Then create a dedicated IAM user and configure the CLI with its keys:

1. Console → **IAM** → **Users** → **Create user**, name it `oasi-deploy`.
2. **Attach policies directly** → `AdministratorAccess`. (Worth narrowing
   later to just what CDK touches; fine to start here.)
3. Open the user → **Security credentials** → **Create access key** →
   **Command Line Interface (CLI)**. The secret is shown **once**.

```bash
aws configure --profile oasi   # region us-east-1, output json
export AWS_PROFILE=oasi
aws sts get-caller-identity    # confirms it works
```

> **Never create access keys on the root user.** They cannot be scoped and
> cannot be rotated without disruption — that is the whole reason for the
> separate `oasi-deploy` user.
>
> `~/.aws/credentials` now holds a long-lived secret in plain text. Keep it
> off shared machines, and delete the key in IAM when it is no longer needed.
> The more robust alternative is IAM Identity Center (`aws configure sso`),
> where credentials expire on their own.

---

## 1. Deploy the auth stack

```bash
cd proyectos-backend/infra
npm ci

export AWS_PROFILE=oasi

# Once per account+region
npx cdk bootstrap

# Cognito only
npx cdk deploy Oasi-Auth-dev -c stage=dev
```

It prints three values:

```
Oasi-Auth-dev.UserPoolId        us-east-1_XXXXXXXXX
Oasi-Auth-dev.UserPoolClientId  xxxxxxxxxxxxxxxxxxxxxxxxxx
Oasi-Auth-dev.Region            us-east-1
```

These are **not secrets** — they ship inside the frontend bundle by design.
Safe to paste into chat, a ticket, or a config file.

> Prefer the console? Create a user pool with: email sign-in, self-registration
> **off**, a 12-character password policy, an app client **without** a client
> secret and SRP auth enabled, and five groups named exactly `admin`, `oasi`,
> `organismo`, `empresa`, `region`. The CDK stack does all of that.

---

## 2. Point the frontend at it

Local (`proyectos-frontend/.env`):

```
VITE_API_URL=http://localhost:3001
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=us-east-1
```

In Amplify Hosting: the same four, under App settings → Environment variables.

These are read at **build time** (Vite inlines them), so changing one means
rebuilding — `npm run dev` restart locally, redeploy on Amplify.

The app decides its mode from these variables:

| | Login screen | Role comes from |
|---|---|---|
| Variables empty | no | the dev switcher in the top bar |
| Variables set | **yes** | the Cognito JWT |

So leaving them out of your local `.env` keeps development exactly as it is
today.

---

## 3. Point the backend at it

`proyectos-backend/.env`:

```
AUTH_MODE=cognito
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=us-east-1
```

Deployed, the CDK stack sets these on the Lambda automatically.

**`AUTH_MODE=dev` in a deployed environment means anyone can choose their own
role with an HTTP header.** It exists for local work only.

---

## 4. Create the first admin

Two halves, both required: Cognito holds the account, the `usuarios` table
holds the role and the scope. One script does both, for a deployed
environment:

```bash
cd proyectos-backend
export AWS_PROFILE=oasi
scripts/create-admin.sh dev tu.correo@economia.cl "Tu Nombre"
```

It creates the Cognito account (or reuses an existing one), adds it to the
`admin` group, and writes the `usuarios` row through the environment's db-ops
Lambda. A new account receives a temporary password by email; the login
screen handles the forced change on first sign-in.

For a **local** database, the second half is a plain insert:

```sql
INSERT INTO usuarios (cognito_sub, nombre, email, rol)
VALUES ('<sub from admin-get-user>', 'Tu Nombre', 'tu.correo@economia.cl', 'admin');
```

Scoped roles (`empresa`, `organismo`, `region`) need their scope column
(`empresa_id`, `organismo_id`, `region_id`), or the backend refuses to
authenticate them — failing closed rather than showing everything. The app's
user screen always sets it.

After the first admin exists, **everyone else is created from Administración
→ Usuarios in the app** — one action does both halves: it creates the Cognito
account (which emails the person an invite with a temporary password) and the
`usuarios` row with the role and its scope. No AWS CLI needed for that.
Deleting a user from that screen removes both halves too.

Locally, that screen needs your CLI credentials to reach Cognito:

```bash
export AWS_PROFILE=oasi
npm run dev   # in proyectos-backend
```

Deployed, the Lambda already has exactly the permissions it needs for this
(`cognito-idp:AdminCreateUser`, `AdminAddUserToGroup`,
`AdminRemoveUserFromGroup`, `AdminDeleteUser` — see `oasi-stack.ts`), so
nothing extra to configure there.

---

## What this stack does NOT create

`Oasi-Auth-<stage>` is Cognito only. The network, database, API and bucket
live in `Oasi-<stage>` — see [`DEPLOYMENT.md`](../DEPLOYMENT.md).

To take Cognito down again: `npx cdk destroy Oasi-Auth-dev -c stage=dev`
(in `dev` it deletes the pool and its users; in `prod` it is set to retain).
