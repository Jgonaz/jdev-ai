import type { SVGProps } from 'react';

// Iconos del diseño aprobado. Son decorativos: el botón que los contiene lleva
// su aria-label o su texto.
type Props = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...resto }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      {...resto}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: Props) => (
  <Svg strokeWidth={2.5} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconFilter = (p: Props) => (
  <Svg {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Svg>
);
export const IconClose = (p: Props) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconDots = (p: Props) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </Svg>
);
export const IconTerminal = (p: Props) => (
  <Svg strokeWidth={2.5} {...p}>
    <path d="M4 17l6-5-6-5M12 19h8" />
  </Svg>
);
export const IconLock = (p: Props) => (
  <Svg {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);
export const IconLayout1 = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
  </Svg>
);
export const IconLayout2 = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16" />
  </Svg>
);
export const IconLayout4 = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M12 4v16M3 12h18" />
  </Svg>
);
export const IconSidePanel = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);
export const IconCopy = (p: Props) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </Svg>
);
export const IconStop = (p: Props) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Svg>
);
export const IconClock = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconRestore = (p: Props) => (
  <Svg {...p}>
    <path d="M5 4v6h6" />
    <path d="M5.6 15a8 8 0 1 0 .9-6.4L5 10" />
  </Svg>
);
export const IconChevron = (p: Props) => (
  <Svg strokeWidth={2.5} {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);
export const IconImage = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 17l-5-5-9 8" />
  </Svg>
);
export const IconZoomOut = (p: Props) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconZoomIn = (p: Props) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconExternal = (p: Props) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const IconAlert = (p: Props) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v6M12 16.5v.5" />
  </Svg>
);
export const IconPencil = (p: Props) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
);
export const IconToTop = (p: Props) => (
  <Svg {...p}>
    <path d="M6 4h12M7 14l5-5 5 5M7 20l5-5 5 5" />
  </Svg>
);
export const IconToBottom = (p: Props) => (
  <Svg {...p}>
    <path d="M6 20h12M7 10l5 5 5-5M7 4l5 5 5-5" />
  </Svg>
);
export const IconWarning = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 10v4M12 17v.5" />
  </Svg>
);
export const IconBranch = (p: Props) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 8v8M18 10c0 4-6 3-12 6" />
  </Svg>
);
export const IconSpark = (p: Props) => (
  <Svg {...p}>
    <path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z" />
  </Svg>
);
export const IconShell = (p: Props) => (
  <Svg {...p}>
    <path d="M5 7l5 5-5 5M12 17h7" />
  </Svg>
);
export const IconArtifact = (p: Props) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 9h16" />
  </Svg>
);
export const IconArchive = (p: Props) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4" />
  </Svg>
);
