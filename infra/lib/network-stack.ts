import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { SHARED } from '../config'

/**
 * ============================================================================
 * RED — una sola VPC, compartida por dev y prod
 * ============================================================================
 *
 * Por qué una sola y no una por ambiente: cada VPC privada necesita su propia
 * salida a internet, y esa salida es lo único caro de la red. Con una VPC
 * compartida se paga una vez (~US$7/mes) en lugar de dos.
 *
 * Los ambientes siguen separados en todo lo demás: su propia base de datos
 * con su propio usuario, su propio Cognito, su propia Lambda, su propio
 * bucket. Lo único que comparten es el cableado.
 *
 * Tres grupos de subnets:
 *   public    lo único que vive acá es el NAT. Tiene IP pública.
 *   private   las Lambdas. Salen a internet a través del NAT; nadie de
 *             internet puede entrar.
 *   isolated  la base de datos. SIN ruta a internet, en ningún sentido.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN DE COSTO CONSCIENTE (no es un descuido)
 * ---------------------------------------------------------------------------
 * AWS ofrece dos formas de dar salida a internet a una subnet privada:
 *
 *   NAT Gateway   servicio administrado, alta disponibilidad.  ~US$32/mes
 *   NAT instance  una máquina EC2 diminuta haciendo el trabajo. ~US$7/mes
 *
 * Este proyecto es un sistema interno de gobierno con ~20 usuarios y
 * presupuesto ajustado, así que usa el NAT instance y el NAT Gateway está
 * prohibido (ver PROMPT_CLAUDE_CODE.md en la raíz del repo).
 *
 * Lo que se resigna: el NAT instance NO se recupera solo. Si esa máquina se
 * detiene, las Lambdas pierden el acceso a Secrets Manager y a Cognito, y la
 * API deja de responder hasta que se prenda de nuevo. Cómo detectarlo y cómo
 * arreglarlo está en infra/README.md.
 *
 * La alternativa sin NAT de ningún tipo sería poner endpoints privados de
 * Secrets Manager y Cognito (~US$15/mes): más caro que el NAT instance y con
 * más piezas, por eso no se usa.
 * ============================================================================
 */
export class NetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc
  /** Subnets donde viven las Lambdas (salida a internet vía NAT). */
  readonly lambdaSubnets: ec2.SubnetSelection
  /** Subnets de la base de datos (sin ninguna ruta a internet). */
  readonly databaseSubnets: ec2.SubnetSelection
  /** Se lo ponen las Lambdas. Es el único que la base acepta. */
  readonly lambdaSecurityGroup: ec2.SecurityGroup
  /** Se lo pone la base de datos. */
  readonly databaseSecurityGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Las dos subnets privadas se declaran PRIVATE_ISOLATED (sin NAT
    // administrado) y más abajo se le agrega a mano la ruta de salida al grupo
    // 'private'. Es lo que permite tener NAT instance sin NAT Gateway.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: 'oasi',
      ipAddresses: ec2.IpAddresses.cidr(SHARED.vpcCidr),
      maxAzs: 2, // RDS exige que su grupo de subnets abarque dos zonas
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    })

    this.lambdaSubnets = { subnetGroupName: 'private' }
    this.databaseSubnets = { subnetGroupName: 'isolated' }

    // ------------------------------------------------------------------
    // NAT instance
    //
    // Está armado a mano en vez de usar ec2.NatProvider.instanceV2 por un
    // motivo concreto: ese provider crea las rutas apuntando al ID DE LA
    // INSTANCIA, que es la forma antigua de EC2, y esa llamada falla con
    // "An internal error has occurred (Status Code: 500)" — nos rebotó dos
    // despliegues seguidos. Acá la interfaz de red se crea aparte y las rutas
    // apuntan a ELLA, que es la forma recomendada hoy: la interfaz existe
    // antes de que la máquina arranque, así que no hay carrera posible.
    // ------------------------------------------------------------------
    const natSecurityGroup = new ec2.SecurityGroup(this, 'NatSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'oasi-nat',
      description: 'OASI NAT: solo rutea trafico de esta VPC hacia afuera',
      allowAllOutbound: true,
    })

    // Solo las máquinas de esta VPC pueden rutear por el NAT. Nada de
    // internet puede abrir conexiones hacia él.
    natSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.allTraffic(),
      'Trafico interno de la VPC saliendo por el NAT',
    )

    const natInterface = new ec2.CfnNetworkInterface(this, 'NatInterface', {
      subnetId: this.vpc.publicSubnets[0].subnetId,
      groupSet: [natSecurityGroup.securityGroupId],
      // Imprescindible: por defecto EC2 descarta los paquetes cuyo origen o
      // destino no es la propia máquina, que es justo lo que hace un NAT.
      sourceDestCheck: false,
      description: 'OASI NAT',
    })

    const natInstance = new ec2.CfnInstance(this, 'NatInstance', {
      instanceType: SHARED.natInstanceType,
      imageId: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64, // t4g es ARM
      }).getImage(this).imageId,
      networkInterfaces: [{ deviceIndex: '0', networkInterfaceId: natInterface.ref }],
      // Créditos "standard": una máquina que solo rutea nunca necesita
      // ráfagas, y así no puede generar cargos por CPU extra.
      creditSpecification: { cpuCredits: 'standard' },
      userData: cdk.Fn.base64(natInstanceUserData().render()),
      tags: [{ key: 'Name', value: 'oasi-nat' }],
    })

    // El user data corre UNA sola vez, en el primer arranque, y
    // CloudFormation lo actualiza sin reiniciar la máquina. Si cambiás
    // natInstanceUserData(), agregale una letra a este id para forzar una
    // instancia nueva; si no, el cambio queda escrito pero nunca se aplica.
    natInstance.overrideLogicalId('OasiNatInstanceA')

    const natEip = new ec2.CfnEIP(this, 'NatEip', { domain: 'vpc' })
    new ec2.CfnEIPAssociation(this, 'NatEipAssociation', {
      allocationId: natEip.attrAllocationId,
      networkInterfaceId: natInterface.ref,
    })

    // La salida a internet de las subnets de las Lambdas.
    this.vpc.selectSubnets(this.lambdaSubnets).subnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `NatRoute${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        networkInterfaceId: natInterface.ref,
      })
    })

    // El tráfico a S3 sale por acá y no por el NAT. Los gateway endpoints son
    // gratis, así que esto no agrega costo y descarga al NAT.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    })

    // ------------------------------------------------------------------
    // Security groups de la app
    // ------------------------------------------------------------------
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'oasi-lambdas',
      description: 'OASI Lambdas: salida libre, nadie entra',
      allowAllOutbound: true,
    })

    // OJO: las descripciones de security group solo aceptan caracteres
    // simples. Una tilde o un guion largo hacen fallar el deploy.
    this.databaseSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: 'oasi-database',
      description: 'OASI Postgres: solo lo alcanzan las Lambdas de OASI',
      allowAllOutbound: false,
    })

    this.databaseSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Lambdas de OASI hacia Postgres',
    )

    // Si en config.ts se activa publiclyAccessible, estas IPs (y solo estas)
    // pueden conectarse al puerto 5432 desde internet.
    if (SHARED.database.publiclyAccessible) {
      for (const cidr of SHARED.database.allowedDbIps) {
        this.databaseSecurityGroup.addIngressRule(
          ec2.Peer.ipv4(cidr),
          ec2.Port.tcp(5432),
          `IP autorizada en config.ts: ${cidr}`,
        )
      }
    }

    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId })
    new cdk.CfnOutput(this, 'NatInstanceId', { value: natInstance.ref })
    new cdk.CfnOutput(this, 'NatPublicIp', { value: natEip.ref })
  }
}

/**
 * Configuración del NAT instance.
 *
 * Son los comandos habituales para convertir una máquina Linux en NAT, con
 * tres correcciones aprendidas rompiéndose en este proyecto:
 *
 *  1. Un swap de 1 GB antes de instalar. En una t4g.nano (0,5 GB de RAM) el
 *     `dnf install` se muere por falta de memoria, el script sigue de largo
 *     sin iptables, y la máquina no rutea nada. El síntoma no dice nada:
 *     todas las Lambdas fallan con "timeout" al conectarse a la base.
 *  2. `ip route` en vez de `route`, que no viene en Amazon Linux 2023.
 *  3. `iptables-save` en vez de `service iptables save`, que Amazon Linux 2023
 *     no soporta (sin esto las reglas se pierden al reiniciar).
 *
 * El `-xe` del shebang hace que, si algo falla, se vea en la consola de la
 * instancia y el script se detenga, en vez de quedar a medio configurar.
 */
function natInstanceUserData(): ec2.UserData {
  const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash -xe' })
  userData.addCommands(
    'fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile',
    'dnf install -y --setopt=install_weak_deps=False iptables-services',
    'systemctl enable --now iptables',
    'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf',
    'sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf',
    'IFACE="$(ip route show default | awk \'{print $5; exit}\')"',
    'iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
    // Las reglas que trae iptables-services RECHAZAN todo el forwarding.
    'iptables -F FORWARD',
    'iptables-save > /etc/sysconfig/iptables',
  )
  return userData
}
