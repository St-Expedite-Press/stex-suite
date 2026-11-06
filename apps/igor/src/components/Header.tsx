import type { RefObject } from 'react';
import { InfoIcon, MenuIcon } from './Icons';

type HeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onAbout: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
};

export function Header({ sidebarOpen, onToggleSidebar, onAbout, toggleRef }: HeaderProps) {
  return (
    <header className="igor-header">
      <div className="igor-header__start">
        <a className="igor-brand" href="/home/" aria-label="STEX Pantheon home">
          <span className="igor-brand__mark" aria-hidden="true" />
          <span className="igor-brand__text">
            <span className="igor-brand__name">STEX</span>
            <span className="igor-brand__sub">Pantheon</span>
          </span>
        </a>
        <a className="igor-back" href="/home/">
          <span aria-hidden="true">‹</span> Pantheon
        </a>
      </div>
      <div className="igor-header__title">
        <span className="igor-title">Igor</span>
      </div>
      <div className="igor-header__end">
        <button
          ref={toggleRef}
          type="button"
          className="igor-icon-button igor-sidebar-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="igor-sidebar"
          aria-label="Conversations"
          onClick={onToggleSidebar}
        >
          <MenuIcon />
        </button>
        <button type="button" className="igor-icon-button" aria-label="About Igor" onClick={onAbout}>
          <InfoIcon />
        </button>
      </div>
    </header>
  );
}
