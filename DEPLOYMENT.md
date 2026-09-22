# Deployment

La documentación de infraestructura y despliegue vive ahora en
**[`infra/README.md`](infra/README.md)**, junto al código que describe.

Ahí está:

- qué levanta cada stack, con diagrama
- cómo desplegar dev y prod
- cómo pasar dev de base compartida a su propio servidor RDS
- cómo agregar una IP a las permitidas del RDS
- qué hacer si un deploy falla a la mitad
- el costo mensual estimado, desglosado
- cómo destruir todo y empezar de nuevo

La configuración de todos los ambientes está en un solo archivo:
[`infra/config.ts`](infra/config.ts).
