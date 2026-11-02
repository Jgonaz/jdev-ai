import { formatAgo, limitsView } from '../lib/statusline.ts';
import type { LimitView, Level } from '../lib/statusline.ts';
import { useNow } from '../lib/useNow.ts';
import { useSessions } from '../state/SessionsContext.tsx';
import type { AccountLimits } from '../types.ts';
import { Disclosure } from './Disclosure.tsx';
import { IconWarning } from './Icons.tsx';

function Bar({ nombre, vista }: { nombre: string; vista: LimitView }) {
  return (
    <span className="lim">
      <span className="lim__top">
        <span className="lim__name">{nombre}</span>
        <span className={`lim__pct lim__pct--${vista.level}`}>
          {vista.level === 'critical' && <IconWarning size={11} />}
          {vista.text}
        </span>
      </span>
      <span className={`lim__track lim__track--${vista.level}`} aria-hidden="true">
        {vista.percent !== null && <span className={`lim__fill lim__fill--${vista.level}`} style={{ width: `${vista.percent}%` }} />}
      </span>
    </span>
  );
}

function Detail({ cuenta }: { cuenta: AccountLimits }) {
  // Solo mientras el desplegable está abierto: la antigüedad cuenta los segundos.
  const ahora = useNow(1000);
  const vista = limitsView(cuenta, ahora);
  if (!vista) return null;
  const linea = (nombre: string, v: LimitView | null) =>
    v && (
      <span>
        Ventana de {nombre}: <strong>{v.text}</strong>
        {v.reset && ` · ${v.reset === 'ya se reinició' ? v.reset : `se reinicia ${v.reset}`}`}
      </span>
    );
  return (
    <>
      {linea('5 horas', vista.fiveHour)}
      {linea('7 días', vista.sevenDay)}
      <span className="hdrpop__note">Dato de la sesión de Claude más reciente · {formatAgo(cuenta.updatedAt, ahora)}</span>
    </>
  );
}

/**
 * Límites de uso de 5 horas y 7 días de la cuenta, como dos minibarras; al
 * pulsarlos, la hora de reinicio de cada uno y la antigüedad del dato. Se oculta
 * si ninguna sesión de Claude del panel ha informado todavía.
 */
export function HeaderLimits() {
  const { account } = useSessions();
  const ahora = useNow(15_000);
  const vista = limitsView(account, ahora);
  if (!vista || !account) return null;
  const nivel: Level = vista.level;
  return (
    <Disclosure
      wrapClassName="hdrmenu"
      buttonClassName={`hdrbtn hdrlim hdrlim--${nivel}`}
      label={vista.label}
      kind="dialog"
      popLabel="Límites de la cuenta"
      popClassName="menu__list hdrpop"
      button={
        <>
          {vista.fiveHour && <Bar nombre="5 h" vista={vista.fiveHour} />}
          {vista.sevenDay && <Bar nombre="7 d" vista={vista.sevenDay} />}
        </>
      }
    >
      {() => <Detail cuenta={account} />}
    </Disclosure>
  );
}
