// Configuración General del Documento (Typst)
#set document(title: "Informe Técnico - Mr. Sushi", author: ("Choque", "Borjas", "Huerta"))
#set page(
  paper: "a4",
  margin: (x: 2.5cm, top: 3cm, bottom: 2.5cm),
  header: align(right, text(8pt, fill: luma(120), font: ("Fira Sans", "Arial", "sans-serif"))[Informe Técnico - Proyecto Mr. Sushi]),
  footer: context {
    let page_number = counter(page).get().first()
    let total_pages = counter(page).final().first()
    if page_number > 1 {
      align(center, text(9pt, fill: luma(80))[Página #page_number de #total_pages])
    }
  }
)
#set text(
  font: ("Fira Sans", "Arial", "sans-serif"),
  size: 11pt,
  fill: rgb("#232F3E"),
  spacing: 120%
)
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.1.")

// Estilos de Título y Subtítulos
#show heading: it => block(below: 1em)[
  #set text(weight: "bold", fill: rgb("#111827"))
  #if it.level == 1 {
    v(1.5em)
    text(16pt)[#it.body]
  } else if it.level == 2 {
    v(1em)
    text(13pt)[#it.body]
  } else {
    v(0.8em)
    text(11pt)[#it.body]
  }
]

// --- PORTADA ---
#align(center + horizon)[
  #v(-4em)
  #rect(width: 100%, stroke: rgb("#FF9900"), inset: 15pt, radius: 4pt)[
    #text(20pt, weight: "bold", fill: rgb("#232F3E"))[INFORME]
    #v(0.5em)
    #text(16pt, weight: "medium", fill: rgb("#FF9900"))[Mr. Sushi: Sistema de Pedidos]
  ]
  
  #v(3em)
  #text(12pt, weight: "bold")[Cloud Computing]
  #v(4em)
  
  #grid(
    columns: (auto, auto),
    row-gutter: 1.5em,
    column-gutter: 2em,
    align: (left, left),
    text(weight: "bold")[Integrantes del Grupo:], [],
    "Choque Coaquira, Rafael Rodrigo", "(Código: 202410378)",
    "Borjas Bernaola, Gerald Marcelo Fernando", "(Código: 202510059)",
    "Huerta Roque, Francis Andres", "(Código: 20231053)"
  )
  
  #v(8em)
  #text(10pt, fill: luma(100))[Universidad de Ingeniería y Tecnología (UTEC) \ \ 2026]
]

#pagebreak()

// --- CONTENIDO ---

= Resumen Ejecutivo
El presente documento detalla la arquitectura de software implementada para la cadena de restaurantes "Mr. Sushi". La solución ha sido diseñada bajo un modelo de arquitectura serverless nativa, orientada a eventos (EDA) e híbrida multi-nube. 

El sistema gestiona de forma aislada las operaciones de 8 sedes físicas (comportándose como un esquema multi-tenant), mientras mantiene consolidados los datos de usuarios clientes globales y su programa de lealtad (Neki Puntos). La infraestructura backend corre principalmente sobre Amazon Web Services (AWS) utilizando el Serverless Framework para la orquestación del ciclo de vida, mientras que la integración con servicios de terceros (Rappi) se simula mediante una arquitectura en Google Cloud Platform (GCP) orquestada a través de Terraform.

= Estructura General del Repositorio
La base del código del proyecto se encuentra estructurada de manera modular en cuatro directorios raíz:

- *`mrsushi-backend/`*: Contiene la totalidad de la lógica serverless en AWS, dividida en 7 microservicios independientes, cada uno provisto de su propia base de datos NoSQL y configuración de infraestructura en la nube.
- *`frontend-trabajadores/`*: Aplicación de Panel de Control SPA desarrollada sobre *React 19* y *Vite*, utilizada por cocineros, despachadores y repartidores.
- *`mrsushi_clientes/`*: Portal web transaccional público construido en *HTML5/CSS3/Vanilla JS* para los consumidores finales.
- *`api-rappi-gcp/`*: Código fuente e infraestructura como código (Terraform) de la API externa desplegada sobre Google Cloud Platform.

= Arquitectura del Sistema
La arquitectura del sistema descansa sobre dos pilares tecnológicos principales: el desacoplamiento estricto a través de eventos y la orquestación asíncrona de flujos humanos.

== Diagrama de Arquitectura
A continuación, se detalla el diagrama lógico que describe el enrutamiento de peticiones síncronas (REST/HTTP) y la distribución asíncrona de eventos a través del bus personalizado:

// Placeholder de Imagen de Arquitectura (Reemplazar ruta cuando pongas la imagen en la carpeta docs/images/)
#align(center)[
  #image("images/arquitectura.png", width: 100%)
  #v(0.5em)
  #text(9pt, style: "italic", fill: luma(100))[Figura 1: Diagrama de Arquitectura de Solución Híbrida (AWS + GCP)]
]

== Componentes y Orquestación en AWS
- *Amazon EventBridge (`mrsushi-bus`):* Actúa como el núcleo de mensajería (Event Bus). Al crearse un pedido, los microservicios publican eventos aislados. Ningún servicio llama a otro directamente; EventBridge intercepta el evento e inicia la orquestación.
- *AWS Step Functions:* Centraliza el flujo del pedido por medio de una máquina de estados reactiva. La máquina entra en estados de pausa (`waitForTaskToken`) para simular la interacción con el personal en la vida real.
- *AWS Lambda:* El motor de ejecución serverless del backend. Compuesto por funciones granulares en Node.js 18.x.
- *Amazon S3:* Destino final del flujo. Al completarse el ciclo de vida del pedido, la Lambda `generarRecibo` escribe en un bucket S3 un documento `.txt` inmutable que actúa como comprobante de pago.
- *AWS Amplify:* Plataforma de hosting serverless utilizada para alojar ambos frontends de forma independiente.

= Desglose de Microservicios Backend

El backend se encuentra dividido en 7 microservicios completamente independientes. Cada servicio se despliega de manera aislada y tiene control absoluto sobre sus recursos de almacenamiento de datos:

#table(
  columns: (1.5fr, 3.5fr, 2fr),
  inset: 7pt,
  align: (left, left, left),
  stroke: 0.5pt + luma(150),
  fill: (x, y) => if y == 0 { rgb("#EFEFEF") } else { none },
  [*Microservicio*], [*Responsabilidad Técnica*], [*Endpoints / Eventos*],
  [ms-sedes], [Manejo y lectura de las coordenadas y radio de cobertura de las 8 sucursales físicas.], [GET /sedes],
  [ms-autenticacion], [Registro, inicio de sesión y gestión de roles de trabajadores (JWT).], [POST /auth/register\nPOST /auth/login\nGET /auth/me],
  [ms-clientes], [Administración de perfiles de clientes, direcciones de entrega y monedero de Neki Puntos.], [POST /clientes/register\nGET /clientes/me\nPATCH /clientes/me/neki-puntos],
  [ms-pedidos], [Recepción de órdenes, cálculo espacial de distancia a las sedes y emisión del evento `PedidoCreado`.], [POST /pedidos\nGET /pedidos/{pedidoId}],
  [ms-flujo-trabajo], [Recibe las notificaciones de avance del personal y devuelve el Task Token al orquestador.], [POST /flujo-trabajo/completar],
  [ms-stepfunctions], [Definición e infraestructura CloudFormation de la Máquina de Estados del pedido.], [Ejecución interna],
  [ms-recibos], [Escucha de forma asíncrona la finalización del pedido y escribe el recibo en S3.], [Disparado por EventBridge]
)

= Flujo de Trabajo y Callback (Task Tokens)

La orquestación se gestiona de manera asíncrona mediante AWS Step Functions. Para evitar el consumo continuo de CPU en espera de la acción de los cocineros, despachadores y repartidores, se emplea el patrón *Wait for Callback con Task Token*:

1. Al iniciarse la máquina de estados, el flujo entra al estado `CoccionTask` invocando la integración `arn:aws:states:::lambda:invoke.waitForTaskToken`.
2. Step Functions detiene la ejecución del hilo y genera un identificador único en cadena llamado *Task Token*.
3. La Lambda asociada guarda este *Task Token* de forma segura en la tabla `MrSushiFlujoTrabajo` indexándolo por el `pedidoId`.
4. Cuando el trabajador presiona "Completar etapa" en el panel web, el Frontend hace un POST a la API Gateway de `ms-flujo-trabajo`.
5. La Lambda `completarEtapa` recupera el token de DynamoDB y ejecuta la llamada del SDK `SendTaskSuccessCommand` a la API de Step Functions. El flujo se reanuda de inmediato y pasa a la siguiente etapa de empaquetado.

= Diseño de Base de Datos (DynamoDB)

El modelo de persistencia utiliza Amazon DynamoDB en modalidad bajo demanda (PAY_PER_REQUEST). Para cumplir con la flexibilidad del diseño serverless, se utilizan llaves descriptivas en lugar de IDs genéricos:

- *`MrSushiSedes`*: Almacena información estática de las 8 sedes. Llave: `sedeId` (HASH).
- *`MrSushiUsuarios`*: Registra credenciales de trabajadores. Llaves: `sedeId` (HASH) y `email` (RANGE).
- *`MrSushiUsuarioEmailLocks`*: Control transaccional (`TransactWriteItems`) para asegurar que no se registren correos duplicados en distintas sedes. Llave: `email` (HASH).
- *`MrSushiPedidos`*: Información de pedidos. Llaves: `sedeId` (HASH) y `pedidoId` (RANGE). Provee índices secundarios globales (GSI) `ClienteIndex` y `SedeCreatedIndex` para consultas veloces.
- *`MrSushiContadores`*: Mantiene contadores diarios por sede para generar números de ticket secuenciales legibles (ej: ticket #1, #2 del día).

= Integración Multi-Cloud (GCP)
Para cumplir los requerimientos multi-nube, se desacopló el envío de notificaciones hacia el sistema de delivery Rappi.

- La infraestructura de Google Cloud se levantó de manera declarativa con *Terraform*.
- Se desplegó una *Google Cloud Function* escrita sobre Express.js (`rappiWebhook`).
- Cuando un pedido cambia de estado en AWS, el Lambda `completarEtapa` envía un HTTP POST al endpoint de actualización de GCP (`/rappi/estado`) simulando la pantalla del motorizado de Rappi.
- El simulador de Rappi también puede inyectar pedidos de forma inversa llamando síncronamente al endpoint de creación de AWS a través de la ruta `/rappi/pedidos`.

= Evidencias de Funcionamiento

A continuación, se listan los placeholders de evidencias de la implementación para que cargues tus capturas de pantalla de la sustentación:

// Evidencia 1: Clientes
#align(center)[
  #block(stroke: luma(200), inset: 10pt, radius: 4pt)[
    #text(10pt, style: "italic")[Evidencia 1: Interfaz Pública de Clientes (Amplify)]\
    #v(0.5em)
    // #image("images/clientes.png", width: 85%)
  ]
]

// Evidencia 2: Trabajadores
#align(center)[
  #block(stroke: luma(200), inset: 10pt, radius: 4pt)[
    #text(10pt, style: "italic")[Evidencia 2: Panel SPA de Trabajadores (React / Vite)]\
    #v(0.5em)
    // #image("images/trabajadores.png", width: 85%)
  ]
]

// Evidencia 3: Step Functions
#align(center)[
  #block(stroke: luma(200), inset: 10pt, radius: 4pt)[
    #text(10pt, style: "italic")[Evidencia 3: Ejecución de Step Functions (Consola de AWS)]\
    #v(0.5em)
    // #image("images/stepfunctions.png", width: 85%)
  ]
]

// Evidencia 4: S3 Bucket
#align(center)[
  #block(stroke: luma(200), inset: 10pt, radius: 4pt)[
    #text(10pt, style: "italic")[Evidencia 4: Almacenamiento de Comprobantes (.txt) en S3]\
    #v(0.5em)
    // #image("images/s3_recibos.png", width: 85%)
  ]
]

= Conclusiones y Limitaciones
1. *Escalabilidad Serverless:* Toda la infraestructura backend se ajusta de manera elástica según la concurrencia de clientes. Al no contar con servidores aprovisionados en estado ocioso, el costo operativo de la plataforma se aproxima a cero en horas de baja demanda.
2. *Limitaciones del Learner Lab:* La infraestructura corre sobre las cuentas AWS Academy Learner Labs, cuyas credenciales expiran y se reciclan periódicamente. Por tanto, los recursos (DynamoDB, Lambdas, S3) son de naturaleza temporal, aunque la lógica del código y la arquitectura están diseñadas para producción continua en un entorno corporativo real de AWS.
3. *Seguridad y Aislamiento:* El aislamiento multi-sede se resolvió a nivel lógico encriptando la sucursal del trabajador dentro del token JWT de sesión. Así se evita la manipulación maliciosa de IDs de sedes por parte del navegador cliente.
