// Inline icons: 1.5px stroke, currentColor, decorative (aria-hidden).

import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="igor-icon"
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ChatIcon = () => (
  <Icon>
    <path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4z" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon size={20}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const InfoIcon = () => (
  <Icon size={20}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.75v.5" />
  </Icon>
);

export const DetailsIcon = () => (
  <Icon>
    <rect x="4.5" y="4.5" width="15" height="15" rx="1.5" />
    <path d="M8 9h8M8 12h8M8 15h5" />
  </Icon>
);

export const RenameIcon = () => (
  <Icon>
    <path d="M14.5 5.5 18.5 9.5 9 19H5v-4z" />
  </Icon>
);

export const ArchiveIcon = () => (
  <Icon>
    <path d="M4 5h16v4H4zM5.5 9v10h13V9M10 13h4" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />
  </Icon>
);

export const CopyIcon = () => (
  <Icon>
    <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
    <path d="M15.5 8.5V5a.5.5 0 0 0-.5-.5H5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h3.5" />
  </Icon>
);

export const RetryIcon = () => (
  <Icon>
    <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" />
  </Icon>
);

export const SendIcon = () => (
  <Icon size={20}>
    <path d="M4 12 20 4.5 15.5 20l-3.5-6.5zM12 13.5l8-9" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M9 6v12M15 6v12" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M8 5.5v13l10-6.5z" />
  </Icon>
);
