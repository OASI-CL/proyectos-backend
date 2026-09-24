/**
 * ============================================================================
 * CONFIGURACIÓN DE LA INFRAESTRUCTURA — el único archivo que hay que editar
 * ============================================================================
 *
 * Todo valor que una persona pueda querer ajustar (memoria de la Lambda,
 * timeout, tamaño del disco, días de backup, IPs permitidas, ramas de git)
 * vive acá. Los stacks de `lib/` solo leen de este archivo.
 *
 * Cómo se lee este archivo:
 *   SHARED  — lo que dev y prod COMPARTEN (la red y el servidor de base de
 *             datos). Compartirlos es lo que hace que los dos ambientes
 *             juntos cuesten ~US$24/mes en vez de ~US$74.
 *   CONFIG  — lo propio de cada ambiente (su base de datos, su Cognito, su
 *             Lambda, su bucket, su sitio).
 *
 * Nada de acá es secreto: este repositorio es público. Las contraseñas las
 * genera CDK y viven solo en Secrets Manager.
 */

export type EnvName = 'dev' | 'prod'

// ============================================================================
// Tipos
// ============================================================================

export interface DatabaseConfig {
  /**
   * De dónde saca la base de datos este ambiente:
   *
   *   'shared'     usa el servidor RDS compartido, con su propia base y su
   *                propio usuario de Postgres (aislados del otro ambiente).
   *                Costo adicional: US$0.
   *   'dedicated'  crea su PROPIO servidor RDS. Aislamiento total.
   *                Costo adicional: ~US$14/mes.  <-- el cambio de una línea
   *   'local'      no crea nada en AWS ni configura base en la Lambda. Para
   *                cuando el backend corre en tu PC contra Postgres local.
   *                La Lambda desplegada de ese ambiente NO va a poder leer
   *                datos (tu PC no acepta conexiones desde AWS).
   */
  mode: 'shared' | 'dedicated' | 'local'

  /** Nombre de la base dentro del servidor. Ej: 'oasi_dev'. */
  databaseName: string

  /** Usuario de Postgres, dueño de esa base y el único que puede abrirla. */
  databaseUser: string

  /** Solo si mode === 'local'. Lo usa el backend corriendo en tu máquina. */
  localUrl?: string

  // --- Solo si mode === 'dedicated' (si no, se ignoran y manda SHARED.database) ---
  instanceClass?: string
  allocatedStorageGb?: number
  multiAz?: boolean
  backupRetentionDays?: number
}

export interface EnvConfig {
  envName: EnvName

  /** Rama de GitHub que despliega este ambiente (ver .github/workflows/). */
  branch: string

  database: DatabaseConfig

  lambda: {
    /** Más memoria = también más CPU en Lambda. 512 alcanza de sobra acá. */
    memoryMb: number
    /** API Gateway corta a los 29s, así que no tiene sentido pasar de 29. */
    timeoutSeconds: number
  }

  /**
   * Cognito. Si trae ids, se REUSA ese User Pool y no se crea ninguno
   * (es el caso de dev: ya existe, con usuarios de verdad adentro).
   * Si va en undefined, el stack Oasi-Auth-<env> crea uno nuevo.
   */
  cognito: {
    existingUserPoolId?: string
    existingUserPoolClientId?: string
  }

  /**
   * Orígenes (URLs) que pueden llamar a la API desde un navegador.
   * Acá va la URL de Amplify de este ambiente una vez que exista.
   * Si queda vacío, la API desplegada no acepta ningún navegador.
   */
  frontendOrigins: string[]

  /** Id de la app de Amplify, después de crearla en la consola. */
  amplifyAppId?: string

  /** A dónde llegan las alarmas (hay que confirmar la suscripción por mail). */
  alarmEmail: string

  /**
   * Qué pasa con los datos al borrar un stack:
   *   'destroy'  se borran (dev)
   *   'retain'   quedan aunque se borre el stack (prod)
   */
  removalPolicy: 'destroy' | 'retain'
}

// ============================================================================
// Compartido entre ambientes
// ============================================================================

export const SHARED = {
  region: 'us-east-1',

  /** Rango de IPs privadas de la red. No hace falta tocarlo. */
  vpcCidr: '10.0.0.0/16',

  /**
   * Salida a internet de las Lambdas (necesaria para Secrets Manager,
   * Cognito y S3). Es un NAT instance, NO un NAT Gateway:
   *   NAT Gateway  ~US$32/mes  (PROHIBIDO en este proyecto)
   *   NAT instance ~US$7/mes   (esto; una t4g.nano con su IP pública)
   * Contra: no se recupera solo. Si se cae, las Lambdas pierden internet
   * hasta que se prenda de nuevo. Ver infra/README.md.
   */
  natInstanceType: 't4g.nano',

  /** Servidor RDS compartido (lo usan los ambientes con mode: 'shared'). */
  database: {
    /** db.t4g.micro es la clase más barata que ofrece RDS. */
    instanceClass: 'db.t4g.micro',
    /** Postgres. Subir de versión es cambiar este número. */
    engineVersion: '17.5',
    /** 20 GB es el mínimo de RDS. La base real pesa unos pocos MB. */
    allocatedStorageGb: 20,
    /** Multi-AZ duplica el costo. No lo actives salvo que haga falta. */
    multiAz: false,
    /** Backups automáticos. Gratis hasta el tamaño de la base. */
    backupRetentionDays: 7,
    /**
     * Autoescalado de disco DESACTIVADO a propósito: si se activa, el disco
     * puede crecer solo y aparecer en la factura sin que nadie lo decida.
     */
    maxAllocatedStorageGb: undefined as number | undefined,

    /**
     * La base NO es accesible desde internet: vive en subnets aisladas y solo
     * la alcanzan las Lambdas por su security group.
     *
     * Si algún día lo pasás a true (por ejemplo para conectarte con pgAdmin
     * desde tu PC), se abre el puerto 5432 SOLO a las IPs de `allowedDbIps`.
     * Ojo: con la base privada, las Lambdas tienen que estar dentro de la
     * VPC, y eso es lo que obliga al NAT de arriba.
     */
    publiclyAccessible: false,

    /**
     * IPs que pueden conectarse al puerto 5432, en formato CIDR
     * (una IP suelta se escribe '190.x.x.x/32').
     * Solo tiene efecto si publiclyAccessible es true.
     * Cómo averiguar tu IP: https://checkip.amazonaws.com
     */
    allowedDbIps: [] as string[],
  },
}

// ============================================================================
// Por ambiente
// ============================================================================

export const CONFIG: Record<EnvName, EnvConfig> = {
  dev: {
    envName: 'dev',
    branch: 'develop',

    database: {
      // Comparte servidor con prod, pero con base y usuario propios: las
      // credenciales de dev no pueden abrir la base de prod (ver el bootstrap
      // en lib/database-stack.ts).
      mode: 'shared',
      databaseName: 'oasi_dev',
      databaseUser: 'oasi_dev_user',
      // Solo se usa con mode: 'local'. Es tu Postgres de WSL.
      localUrl: 'postgresql://postgres:oasi_dev_local@localhost:5432/oasi_dev',
    },

    lambda: { memoryMb: 512, timeoutSeconds: 29 },

    // El User Pool de dev YA EXISTE y tiene usuarios reales adentro, así que
    // se reusa en vez de crear uno nuevo (crear uno nuevo obligaría a volver
    // a invitar a todos). Lo administra el stack viejo Oasi-Auth-dev.
    cognito: {
      existingUserPoolId: 'us-east-1_WDLIW3Jby',
      existingUserPoolClientId: '46cb3he4cbplji8chmj066vud6',
    },

    frontendOrigins: [
      // Permite correr el frontend en tu PC contra la API de dev desplegada
      // (npm run dev:aws en proyectos-frontend).
      'http://localhost:5173',
      // El sitio de dev en Amplify (rama develop).
      'https://develop.dyfx5stqf038v.amplifyapp.com',
    ],

    alarmEmail: 'oasi-ti@economia.cl',
    removalPolicy: 'destroy',
  },

  prod: {
    envName: 'prod',
    branch: 'main',

    database: {
      mode: 'shared',
      databaseName: 'oasi_prod',
      databaseUser: 'oasi_prod_user',
    },

    lambda: { memoryMb: 512, timeoutSeconds: 29 },

    // prod todavía no tiene User Pool: el stack Oasi-Auth-prod lo crea.
    cognito: {},

    frontendOrigins: [
      // Rama main de la app de Amplify.
      'https://main.dyfx5stqf038v.amplifyapp.com',
    ],

    alarmEmail: 'oasi-ti@economia.cl',
    removalPolicy: 'retain',
  },
}

// ============================================================================
// Cuenta (stack Oasi-Account, se despliega a mano una sola vez)
// ============================================================================

export const ACCOUNT = {
  githubOrg: 'OASI-CL',
  githubRepo: 'proyectos-backend',
  /** Gasto mensual que dispara un aviso por correo (US$). */
  monthlyBudgetUsd: 100,
  budgetEmail: 'oasi-ti@economia.cl',
}

// ============================================================================
// Helpers
// ============================================================================

export function envConfig(name: string): EnvConfig {
  if (name !== 'dev' && name !== 'prod') {
    throw new Error(`Ambiente desconocido "${name}". Usá 'dev' o 'prod'.`)
  }
  return CONFIG[name]
}

/** true si algún ambiente necesita el servidor RDS compartido. */
export function sharedDatabaseNeeded(): boolean {
  return Object.values(CONFIG).some((env) => env.database.mode === 'shared')
}
