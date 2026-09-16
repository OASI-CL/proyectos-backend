# Cognito setup

Step-by-step to get login working. **Nothing here costs money**: Cognito is
free up to 50,000 monthly active users, and this stack deliberately leaves out
everything that is not (see "What this does NOT create" at the end).

---

## 1. Deploy the auth stack

```bash
cd proyectos-backend/infra
npm ci

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
holds the role and the scope.

```bash
POOL=us-east-1_XXXXXXXXX
EMAIL=tu.correo@economia.gob.cl

# Cognito sends an invitation with a temporary password
aws cognito-idp admin-create-user \
  --user-pool-id "$POOL" \
  --username "$EMAIL" \
  --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
                    Name=name,Value="Tu Nombre"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$POOL" --username "$EMAIL" --group-name admin

# The sub is the id the app keys off
aws cognito-idp admin-get-user --user-pool-id "$POOL" --username "$EMAIL" \
  --query 'UserAttributes[?Name==`sub`].Value' --output text
```

Then the row in the database (locally, that is just `psql` against your dev
instance):

```sql
INSERT INTO usuarios (cognito_sub, nombre, email, rol)
VALUES ('<sub>', 'Tu Nombre', 'tu.correo@economia.gob.cl', 'admin');
```

First sign-in uses the temporary password from the email; Cognito then forces
a password change, which the login screen handles.

### Scoped roles

`empresa`, `organismo` and `region` need their scope, or the backend refuses
to authenticate them (failing closed rather than showing everything):

```sql
-- sees only BHP's projects
INSERT INTO usuarios (cognito_sub, nombre, email, rol, empresa_id)
VALUES ('<sub>', 'Nombre', 'mail@empresa.cl', 'empresa', 1);

-- sees only DGA's permits
INSERT INTO usuarios (cognito_sub, nombre, email, rol, organismo_id)
VALUES ('<sub>', 'Nombre', 'mail@dga.cl', 'organismo', 5);

-- sees every project in Antofagasta, all agencies
INSERT INTO usuarios (cognito_sub, nombre, email, rol, region)
VALUES ('<sub>', 'Nombre', 'mail@gore.cl', 'region', 'Antofagasta');
```

After the first admin exists, the rest is done from **Administración →
Usuarios** in the app — though the Cognito account still has to be created
first (the two `aws cognito-idp` commands above).

---

## What this does NOT create

Deliberately, so nothing starts billing before you decide:

- no VPC or **NAT gateway** (~US$32/month, the main cost of the full stack)
- no RDS instance
- no Lambda or API Gateway
- no S3 bucket

Those live in `Oasi-<stage>`, deployed separately with
`npx cdk deploy Oasi-dev -c stage=dev` when the API needs to be online.

To take Cognito down again: `npx cdk destroy Oasi-Auth-dev -c stage=dev`
(in `dev` it deletes the pool and its users; in `prod` it is set to retain).
