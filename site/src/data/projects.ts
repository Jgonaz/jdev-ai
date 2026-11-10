// Datos de ejemplo de la pantalla Proyectos del panel simulado (Backlog,
// Cambios y Guías). Nada es real. Los proyectos van en el mismo orden que
// `panel.projects` de los diccionarios.

type Card = { title: string; text: string; type: string; date: string };
// Línea de diff: [tipo, texto], con tipo ' ' (contexto), '+' o '-'.
type DiffLine = [' ' | '+' | '-', string];
type ChangedFile = { path: string; status: 'A' | 'M'; add: number; del: number; lines: DiffLine[] };
type Place = { id: string; label: string; branch: string; note: string; files: ChangedFile[] };
type Block = { h?: string; p?: string; ol?: string[] };
type Guide = { id: string; title: string; blocks: Block[] };

type ProjectData = {
  // Tarjetas por columna, en el orden de `columns`.
  backlog: Card[][];
  places: Place[];
  guides: Guide[];
};

type ProjectsScreen = {
  labels: {
    list: string;
    tabs: string;
    backlog: string;
    changes: string;
    guides: string;
    empty: string;
    quiet: string;
    quietHint: string;
    places: string;
    files: string;
    filesCount: string;
    noChanges: string;
    noChangesHint: string;
    noGuides: string;
    guidesList: string;
  };
  columns: { key: string; label: string; hint: string }[];
  projects: ProjectData[];
};

const cartTokens: DiffLine[] = [
  ['+', ':root {'],
  ['+', '  --cart-bg: #ffffff;'],
  ['+', '  --cart-line: #e4e4e7;'],
  ['+', '  --cart-accent: #2563eb;'],
  ['+', '  --cart-danger: #dc2626;'],
  ['+', '}'],
];
const cartCss: DiffLine[] = [
  [' ', '.cart {'],
  ['-', '  background: #ffffff;'],
  ['+', '  background: var(--cart-bg);'],
  ['-', '  border: 1px solid #e4e4e7;'],
  ['+', '  border: 1px solid var(--cart-line);'],
  [' ', '}'],
  [' ', ''],
  [' ', '.cart__remove {'],
  ['-', '  color: #dc2626;'],
  ['+', '  color: var(--cart-danger);'],
  [' ', '}'],
];
const cartTotalCss: DiffLine[] = [
  [' ', '.cart-total__cta {'],
  ['-', '  background: #2563eb;'],
  ['+', '  background: var(--cart-accent);'],
  [' ', '  color: #ffffff;'],
  [' ', '}'],
];

export const projectsScreen: Record<'es' | 'en', ProjectsScreen> = {
  es: {
    labels: {
      list: 'Proyectos',
      tabs: 'Pantallas de proyecto',
      backlog: 'Backlog',
      changes: 'Cambios',
      guides: 'Guías',
      empty: 'Nada por aquí.',
      quiet: 'El taller está tranquilo',
      quietHint: 'Elige algo de «por hacer» y pulsa «Trabajar en esto».',
      places: 'Lugares con cambios',
      files: 'Archivos cambiados',
      filesCount: 'archivos',
      noChanges: 'Sin cambios',
      noChangesHint: 'Todo está subido a origin/main y no hay cambios sin commit.',
      noGuides: 'Este proyecto no tiene guías en docs/user-guides/.',
      guidesList: 'Guías del proyecto',
    },
    columns: [
      { key: 'backlog', label: 'Backlog', hint: 'Por revisar antes de decidir. Aquí entra todo lo nuevo.' },
      { key: 'todo', label: 'Por hacer', hint: 'Revisado y elegido para abordar pronto.' },
      { key: 'doing', label: 'En curso', hint: '' },
      { key: 'done', label: 'Hecho', hint: '' },
    ],
    projects: [
      {
        backlog: [
          [
            {
              title: 'Búsqueda con filtros por talla y color',
              text: 'Hoy la búsqueda solo filtra por categoría y la gente abandona en listados largos.',
              type: 'feature',
              date: '10 mar',
            },
            {
              title: 'Imágenes de producto en WebP',
              text: 'Las fichas pesan demasiado en móvil; convertir las imágenes al subirlas.',
              type: 'mejora',
              date: '6 mar',
            },
          ],
          [
            {
              title: 'Recordatorio de carrito abandonado',
              text: 'Correo a las 24 horas con el contenido del carrito y un enlace para recuperarlo.',
              type: 'feature',
              date: '4 mar',
            },
          ],
          [
            {
              title: 'Login con passkeys',
              text: 'Entrar sin contraseña con la huella o el PIN del dispositivo.',
              type: 'feature',
              date: '2 mar',
            },
          ],
          [
            {
              title: 'Totales del carrito con descuentos por cupón',
              text: 'El total no aplicaba los cupones de porcentaje.',
              type: 'bug',
              date: '11 mar',
            },
          ],
        ],
        places: [
          { id: 'main', label: 'main', branch: 'main', note: 'todo subido a origin/main', files: [] },
          {
            id: 'wt',
            label: 'estilos',
            branch: 'feat/estilos',
            note: 'lo que el worktree llevaría a main',
            files: [
              { path: 'src/styles/tokens.css', status: 'A', add: 6, del: 0, lines: cartTokens },
              { path: 'src/components/Cart.css', status: 'M', add: 3, del: 3, lines: cartCss },
              { path: 'src/components/CartTotal.css', status: 'M', add: 1, del: 1, lines: cartTotalCss },
            ],
          },
        ],
        guides: [
          {
            id: 'g1',
            title: 'Cómo probar un pago en local',
            blocks: [
              { p: 'Para probar el pago de principio a fin sin cobrar a nadie, la tienda usa el entorno de pruebas del proveedor.' },
              { h: 'Pasos' },
              {
                ol: [
                  'Arranca la tienda en desarrollo.',
                  'Añade cualquier producto al carrito y ve a pagar.',
                  'Usa la tarjeta de prueba que aparece en el formulario.',
                  'Comprueba que el pedido aparece como pagado en «Mis pedidos».',
                ],
              },
              { h: 'Si algo falla' },
              { p: 'Si el pedido se queda en «pendiente», el webhook no está llegando: revisa que el túnel local esté abierto.' },
            ],
          },
          {
            id: 'g2',
            title: 'Cómo añadir un cupón',
            blocks: [
              { p: 'Los cupones se crean desde el panel de administración y pueden ser de importe fijo o de porcentaje.' },
              { h: 'Pasos' },
              {
                ol: [
                  'Entra en Administración y abre «Cupones».',
                  'Pulsa «Nuevo cupón» y elige el tipo.',
                  'Indica la fecha de caducidad; sin fecha, no caduca.',
                ],
              },
              { p: 'El descuento se aplica antes de impuestos.' },
            ],
          },
        ],
      },
      {
        backlog: [
          [
            {
              title: 'Límite de peticiones por cliente',
              text: 'Un cliente con un bucle mal hecho puede saturar la API; falta un límite por clave.',
              type: 'mejora',
              date: '9 mar',
            },
          ],
          [
            {
              title: 'Webhook de pagos',
              text: 'Recibir los avisos de pago del proveedor. Bloqueado por la clave del entorno de pruebas.',
              type: 'feature',
              date: '8 mar',
            },
          ],
          [
            {
              title: 'Exportación del informe mensual a PDF',
              text: 'Descargar el informe del mes con el resumen y los totales por categoría.',
              type: 'feature',
              date: '12 mar',
            },
          ],
          [],
        ],
        places: [
          {
            id: 'main',
            label: 'main',
            branch: 'main',
            note: '2 archivos sin commit',
            files: [
              {
                path: 'src/routes/informes.ts',
                status: 'A',
                add: 7,
                del: 0,
                lines: [
                  ['+', "router.get('/informes/:mes.pdf', async (req, res) => {"],
                  ['+', '  const informe = await informeMensual(req.params.mes);'],
                  ['+', "  if (!informe) return res.status(404).end();"],
                  ['+', '  const pdf = await generarPdf(informe);'],
                  ['+', "  res.type('application/pdf');"],
                  ['+', '  res.send(pdf);'],
                  ['+', '});'],
                ],
              },
              {
                path: 'test/informes.test.ts',
                status: 'A',
                add: 5,
                del: 0,
                lines: [
                  ['+', "it('devuelve el PDF del mes pedido', async () => {"],
                  ['+', "  const res = await api.get('/informes/2026-02.pdf');"],
                  ['+', '  expect(res.status).toBe(200);'],
                  ['+', "  expect(res.type).toBe('application/pdf');"],
                  ['+', '});'],
                ],
              },
            ],
          },
        ],
        guides: [],
      },
      {
        backlog: [
          [
            {
              title: 'Guía de primeros pasos para nuevos colaboradores',
              text: 'Qué instalar, cómo arrancar cada proyecto y a quién preguntar.',
              type: 'docs',
              date: '5 mar',
            },
          ],
          [],
          [],
          [
            {
              title: 'Guía de despliegue',
              text: 'Despliegue manual, variables de entorno y vuelta atrás.',
              type: 'docs',
              date: '12 mar',
            },
          ],
        ],
        places: [{ id: 'main', label: 'main', branch: 'main', note: 'todo subido a origin/main', files: [] }],
        guides: [
          {
            id: 'g1',
            title: 'Guía de despliegue',
            blocks: [
              { p: 'El despliegue es manual y se hace desde la rama main, siempre con las validaciones en verde.' },
              { h: 'Pasos' },
              {
                ol: [
                  'Comprueba que main está al día y sin cambios locales.',
                  'Revisa las variables de entorno del entorno de destino.',
                  'Lanza el despliegue y espera a que termine.',
                  'Abre la web publicada y comprueba la página de inicio y el pago.',
                ],
              },
              { h: 'Volver atrás' },
              { p: 'Si algo va mal, promociona el despliegue anterior desde el panel del proveedor: tarda menos de un minuto.' },
            ],
          },
        ],
      },
    ],
  },
  en: {
    labels: {
      list: 'Projects',
      tabs: 'Project screens',
      backlog: 'Backlog',
      changes: 'Changes',
      guides: 'Guides',
      empty: 'Nothing here.',
      quiet: 'The workshop is quiet',
      quietHint: 'Pick something from “to do” and press “Work on this”.',
      places: 'Places with changes',
      files: 'Changed files',
      filesCount: 'files',
      noChanges: 'No changes',
      noChangesHint: 'Everything is pushed to origin/main and there are no uncommitted changes.',
      noGuides: 'This project has no guides in docs/user-guides/.',
      guidesList: 'Project guides',
    },
    columns: [
      { key: 'backlog', label: 'Backlog', hint: 'To review before deciding. Everything new lands here.' },
      { key: 'todo', label: 'To do', hint: 'Reviewed and chosen to tackle soon.' },
      { key: 'doing', label: 'In progress', hint: '' },
      { key: 'done', label: 'Done', hint: '' },
    ],
    projects: [
      {
        backlog: [
          [
            {
              title: 'Search with size and colour filters',
              text: 'Search only filters by category today and people give up on long lists.',
              type: 'feature',
              date: '10 Mar',
            },
            {
              title: 'Product images in WebP',
              text: 'Product pages are too heavy on mobile; convert images on upload.',
              type: 'improvement',
              date: '6 Mar',
            },
          ],
          [
            {
              title: 'Abandoned cart reminder',
              text: 'An email after 24 hours with the cart contents and a link to recover it.',
              type: 'feature',
              date: '4 Mar',
            },
          ],
          [
            {
              title: 'Passkey login',
              text: 'Sign in without a password, with the device’s fingerprint or PIN.',
              type: 'feature',
              date: '2 Mar',
            },
          ],
          [
            {
              title: 'Cart totals with coupon discounts',
              text: 'The total did not apply percentage coupons.',
              type: 'bug',
              date: '11 Mar',
            },
          ],
        ],
        places: [
          { id: 'main', label: 'main', branch: 'main', note: 'everything pushed to origin/main', files: [] },
          {
            id: 'wt',
            label: 'styles',
            branch: 'feat/styles',
            note: 'what the worktree would bring to main',
            files: [
              { path: 'src/styles/tokens.css', status: 'A', add: 6, del: 0, lines: cartTokens },
              { path: 'src/components/Cart.css', status: 'M', add: 3, del: 3, lines: cartCss },
              { path: 'src/components/CartTotal.css', status: 'M', add: 1, del: 1, lines: cartTotalCss },
            ],
          },
        ],
        guides: [
          {
            id: 'g1',
            title: 'How to test a payment locally',
            blocks: [
              { p: 'To test a payment end to end without charging anyone, the shop uses the provider’s test environment.' },
              { h: 'Steps' },
              {
                ol: [
                  'Start the shop in development.',
                  'Add any product to the cart and go to checkout.',
                  'Use the test card shown in the form.',
                  'Check that the order shows as paid in “My orders”.',
                ],
              },
              { h: 'If something fails' },
              { p: 'If the order stays “pending”, the webhook is not arriving: check that the local tunnel is open.' },
            ],
          },
          {
            id: 'g2',
            title: 'How to add a coupon',
            blocks: [
              { p: 'Coupons are created from the admin panel and can be a fixed amount or a percentage.' },
              { h: 'Steps' },
              {
                ol: [
                  'Go to Admin and open “Coupons”.',
                  'Press “New coupon” and choose the type.',
                  'Set the expiry date; without one, it does not expire.',
                ],
              },
              { p: 'The discount is applied before tax.' },
            ],
          },
        ],
      },
      {
        backlog: [
          [
            {
              title: 'Rate limit per client',
              text: 'A client with a badly written loop can saturate the API; a per-key limit is missing.',
              type: 'improvement',
              date: '9 Mar',
            },
          ],
          [
            {
              title: 'Payments webhook',
              text: 'Receive the provider’s payment notifications. Blocked by the test environment key.',
              type: 'feature',
              date: '8 Mar',
            },
          ],
          [
            {
              title: 'Monthly report export to PDF',
              text: 'Download the month’s report with the summary and the totals by category.',
              type: 'feature',
              date: '12 Mar',
            },
          ],
          [],
        ],
        places: [
          {
            id: 'main',
            label: 'main',
            branch: 'main',
            note: '2 uncommitted files',
            files: [
              {
                path: 'src/routes/reports.ts',
                status: 'A',
                add: 7,
                del: 0,
                lines: [
                  ['+', "router.get('/reports/:month.pdf', async (req, res) => {"],
                  ['+', '  const report = await monthlyReport(req.params.month);'],
                  ['+', '  if (!report) return res.status(404).end();'],
                  ['+', '  const pdf = await renderPdf(report);'],
                  ['+', "  res.type('application/pdf');"],
                  ['+', '  res.send(pdf);'],
                  ['+', '});'],
                ],
              },
              {
                path: 'test/reports.test.ts',
                status: 'A',
                add: 5,
                del: 0,
                lines: [
                  ['+', "it('returns the PDF of the requested month', async () => {"],
                  ['+', "  const res = await api.get('/reports/2026-02.pdf');"],
                  ['+', '  expect(res.status).toBe(200);'],
                  ['+', "  expect(res.type).toBe('application/pdf');"],
                  ['+', '});'],
                ],
              },
            ],
          },
        ],
        guides: [],
      },
      {
        backlog: [
          [
            {
              title: 'Getting started guide for new contributors',
              text: 'What to install, how to start each project and who to ask.',
              type: 'docs',
              date: '5 Mar',
            },
          ],
          [],
          [],
          [
            {
              title: 'Deployment guide',
              text: 'Manual deployment, environment variables and rollback.',
              type: 'docs',
              date: '12 Mar',
            },
          ],
        ],
        places: [{ id: 'main', label: 'main', branch: 'main', note: 'everything pushed to origin/main', files: [] }],
        guides: [
          {
            id: 'g1',
            title: 'Deployment guide',
            blocks: [
              { p: 'Deployment is manual and is done from the main branch, always with the validations passing.' },
              { h: 'Steps' },
              {
                ol: [
                  'Check that main is up to date and has no local changes.',
                  'Review the environment variables of the target environment.',
                  'Launch the deployment and wait for it to finish.',
                  'Open the published site and check the home page and the checkout.',
                ],
              },
              { h: 'Rolling back' },
              { p: 'If something goes wrong, promote the previous deployment from the provider’s dashboard: it takes less than a minute.' },
            ],
          },
        ],
      },
    ],
  },
};
