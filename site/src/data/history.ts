// Datos de ejemplo de la pantalla Historial del panel simulado. Nada es real.
// Coinciden con la «actividad reciente» de Inicio (src/i18n).

type Entry = {
  id: string;
  time: string;
  project: string;
  tone: 'done' | 'progress' | 'blocked';
  state: string;
  title: string;
  file: string;
  date: string;
  pending: string[];
  summary: string[];
  decisions: string[];
  next: string;
};

type History = {
  filters: { project: string; state: string; all: string; onlyPending: string };
  labels: {
    pending: string;
    markDone: string;
    done: string;
    summary: string;
    decisions: string;
    next: string;
    resume: string;
    list: string;
  };
  days: { label: string; entries: Entry[] }[];
};

export const history: Record<'es' | 'en', History> = {
  es: {
    filters: { project: 'Proyecto', state: 'Estado', all: 'Todos', onlyPending: 'Solo con «Pendiente de ti»' },
    labels: {
      pending: 'Pendiente de ti',
      markDone: 'Marcar como hecho',
      done: 'hecho',
      summary: 'Resumen',
      decisions: 'Decisiones',
      next: 'Continuación recomendada',
      resume: 'Retomar desde aquí',
      list: 'Entradas del historial',
    },
    days: [
      {
        label: 'Hoy',
        entries: [
          {
            id: 'h1',
            time: '16:40',
            project: 'docs',
            tone: 'done',
            state: 'finalizada',
            title: 'Guía de despliegue en docs/user-guides',
            file: '.agent/history/2026-03-12-1640-guia-de-despliegue.md',
            date: '12 mar 2026, 16:40',
            pending: [],
            summary: [
              'Se buscaba una guía para desplegar sin contexto previo. Está escrita y enlazada desde el README.',
              'Cubre el despliegue manual, las variables de entorno y cómo volver a la versión anterior.',
            ],
            decisions: ['La guía vive en docs/user-guides/ y no en el README, para no alargarlo.'],
            next: 'Revisar la guía tras el próximo despliegue real y corregir lo que no coincida.',
          },
          {
            id: 'h2',
            time: '15:05',
            project: 'api-pedidos',
            tone: 'progress',
            state: 'en curso',
            title: 'Exportación del informe mensual a PDF',
            file: '.agent/history/2026-03-12-1505-informe-mensual-pdf.md',
            date: '12 mar 2026, 15:05',
            pending: [
              'Revisar el PDF de ejemplo y confirmar el formato de las tablas.',
              'Dar el visto bueno al commit del endpoint.',
            ],
            summary: [
              'Se buscaba descargar el informe mensual en PDF. El endpoint GET /informes/:mes.pdf funciona y las validaciones pasan; falta tu revisión del formato.',
              'El PDF incluye el resumen, la tabla de pedidos y los totales por categoría.',
            ],
            decisions: ['El PDF se genera en el servidor para no depender del navegador de quien lo pide.'],
            next: 'Hacer el commit del endpoint de informes cuando el formato esté aprobado.',
          },
        ],
      },
      {
        label: 'Ayer',
        entries: [
          {
            id: 'h3',
            time: '18:20',
            project: 'tienda-web',
            tone: 'done',
            state: 'finalizada',
            title: 'Totales del carrito con descuentos por cupón',
            file: '.agent/history/2026-03-11-1820-totales-con-cupon.md',
            date: '11 mar 2026, 18:20',
            pending: [],
            summary: [
              'El total del carrito no aplicaba los cupones de porcentaje. Corregido, con tests para cupones fijos, de porcentaje y caducados.',
            ],
            decisions: ['El descuento se calcula antes de impuestos, como ya hacía el servidor.'],
            next: 'Nada pendiente: el cambio está integrado en main.',
          },
        ],
      },
      {
        label: 'Lunes 9 de marzo',
        entries: [
          {
            id: 'h4',
            time: '11:10',
            project: 'tienda-web',
            tone: 'done',
            state: 'finalizada',
            title: 'Listado de productos con paginación por cursor',
            file: '.agent/history/2026-03-09-1110-paginacion-por-cursor.md',
            date: '9 mar 2026, 11:10',
            pending: [],
            summary: [
              'El listado tardaba en las últimas páginas. Ahora pagina por cursor y la carga es constante.',
              'Hecho en el worktree «paginacion», integrado por Pull Request tras pasar los checks.',
            ],
            decisions: ['Se conserva el parámetro page durante una versión para no romper enlaces guardados.'],
            next: 'Retirar el parámetro page del listado en la siguiente versión.',
          },
        ],
      },
      {
        label: 'Domingo 8 de marzo',
        entries: [
          {
            id: 'h5',
            time: '19:45',
            project: 'api-pedidos',
            tone: 'blocked',
            state: 'bloqueada',
            title: 'Webhook de pagos: falta la clave del entorno de pruebas',
            file: '.agent/history/2026-03-08-1945-webhook-de-pagos.md',
            date: '8 mar 2026, 19:45',
            pending: ['Pedir la clave del entorno de pruebas al proveedor de pagos.'],
            summary: [
              'Se buscaba recibir los avisos de pago por webhook. El receptor está escrito, pero no se puede probar sin la clave del entorno de pruebas.',
            ],
            decisions: ['No se simula la firma del proveedor: se espera a la clave real para validar.'],
            next: 'Probar el webhook de pagos contra el entorno de pruebas en cuanto llegue la clave.',
          },
        ],
      },
    ],
  },
  en: {
    filters: { project: 'Project', state: 'State', all: 'All', onlyPending: 'Only with “Pending on you”' },
    labels: {
      pending: 'Pending on you',
      markDone: 'Mark as done',
      done: 'done',
      summary: 'Summary',
      decisions: 'Decisions',
      next: 'Recommended continuation',
      resume: 'Resume from here',
      list: 'History entries',
    },
    days: [
      {
        label: 'Today',
        entries: [
          {
            id: 'h1',
            time: '16:40',
            project: 'docs',
            tone: 'done',
            state: 'finished',
            title: 'Deployment guide in docs/user-guides',
            file: '.agent/history/2026-03-12-1640-deployment-guide.md',
            date: '12 Mar 2026, 16:40',
            pending: [],
            summary: [
              'The goal was a guide to deploy without prior context. It is written and linked from the README.',
              'It covers the manual deployment, the environment variables and how to roll back.',
            ],
            decisions: ['The guide lives in docs/user-guides/ and not in the README, to keep that short.'],
            next: 'Review the guide after the next real deployment and fix whatever does not match.',
          },
          {
            id: 'h2',
            time: '15:05',
            project: 'orders-api',
            tone: 'progress',
            state: 'in progress',
            title: 'Monthly report export to PDF',
            file: '.agent/history/2026-03-12-1505-monthly-report-pdf.md',
            date: '12 Mar 2026, 15:05',
            pending: [
              'Review the sample PDF and confirm the format of the tables.',
              'Approve the commit of the endpoint.',
            ],
            summary: [
              'The goal was to download the monthly report as a PDF. The GET /reports/:month.pdf endpoint works and the validations pass; your review of the format is missing.',
              'The PDF includes the summary, the orders table and the totals by category.',
            ],
            decisions: ['The PDF is generated on the server so it does not depend on the requester’s browser.'],
            next: 'Commit the reports endpoint once the format is approved.',
          },
        ],
      },
      {
        label: 'Yesterday',
        entries: [
          {
            id: 'h3',
            time: '18:20',
            project: 'web-shop',
            tone: 'done',
            state: 'finished',
            title: 'Cart totals with coupon discounts',
            file: '.agent/history/2026-03-11-1820-totals-with-coupon.md',
            date: '11 Mar 2026, 18:20',
            pending: [],
            summary: [
              'The cart total did not apply percentage coupons. Fixed, with tests for fixed, percentage and expired coupons.',
            ],
            decisions: ['The discount is calculated before tax, as the server already did.'],
            next: 'Nothing pending: the change is merged into main.',
          },
        ],
      },
      {
        label: 'Monday 9 March',
        entries: [
          {
            id: 'h4',
            time: '11:10',
            project: 'web-shop',
            tone: 'done',
            state: 'finished',
            title: 'Product list with cursor pagination',
            file: '.agent/history/2026-03-09-1110-cursor-pagination.md',
            date: '9 Mar 2026, 11:10',
            pending: [],
            summary: [
              'The list was slow on the last pages. It now paginates by cursor and loading time is constant.',
              'Done in the “pagination” worktree, merged through a Pull Request after the checks passed.',
            ],
            decisions: ['The page parameter is kept for one release so saved links do not break.'],
            next: 'Remove the page parameter from the list in the next release.',
          },
        ],
      },
      {
        label: 'Sunday 8 March',
        entries: [
          {
            id: 'h5',
            time: '19:45',
            project: 'orders-api',
            tone: 'blocked',
            state: 'blocked',
            title: 'Payments webhook: the test environment key is missing',
            file: '.agent/history/2026-03-08-1945-payments-webhook.md',
            date: '8 Mar 2026, 19:45',
            pending: ['Ask the payment provider for the test environment key.'],
            summary: [
              'The goal was to receive payment notifications by webhook. The receiver is written, but it cannot be tested without the test environment key.',
            ],
            decisions: ['The provider’s signature is not simulated: we wait for the real key to validate.'],
            next: 'Test the payments webhook against the test environment as soon as the key arrives.',
          },
        ],
      },
    ],
  },
};
