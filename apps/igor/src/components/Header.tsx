import { useRef, type RefObject } from 'react';
import { useMastheadMotion } from '../chat/motion';
import { InfoIcon, MenuIcon, PauseIcon, PlayIcon } from './Icons';

type HeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onAbout: () => void;
  toggleRef: RefObject<HTMLButtonElement | null>;
};

// The P11 masthead (assets P02/P11), served from Igor's own media copies.
const media = `${import.meta.env.BASE_URL}media/masthead/pantheon-masthead`;
// Pantheon runs only on this machine; hosted Igor (igor.stexpedite.press) has no Pantheon to return to.
const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(window.location.hostname);

export function Header({ sidebarOpen, onToggleSidebar, onAbout, toggleRef }: HeaderProps) {
  const video = useRef<HTMLVideoElement>(null);
  const motion = useMastheadMotion(video);
  return (
    <header className="igor-header" data-motion={motion.playing ? 'playing' : 'still'}>
      <div className="igor-masthead" aria-hidden="true">
        <picture>
          <source media="(max-width: 899px)" srcSet={`${media}-still-960w.webp`} />
          <img
            className="igor-masthead__still"
            alt=""
            width={1920}
            height={288}
            fetchPriority="high"
            decoding="async"
            src={`${media}-still-1920w.webp`}
            srcSet={`${media}-still-1280w.webp 1280w, ${media}-still-1920w.webp 1920w`}
            sizes="100vw"
          />
        </picture>
        <video
          ref={video}
          className="igor-masthead__motion"
          muted
          loop
          playsInline
          preload="none"
          disablePictureInPicture
          tabIndex={-1}
        >
          {/* Codec strings are the encoded profile and level recorded in assets/manifest.json. */}
          <source media="(max-width: 899px)" src={`${media}-loop-960w.webm`} type='video/webm; codecs="av01.0.01M.10"' />
          <source media="(max-width: 899px)" src={`${media}-loop-960w.mp4`} type='video/mp4; codecs="avc1.64001E"' />
          <source media="(max-width: 1279px)" src={`${media}-loop-1280w.webm`} type='video/webm; codecs="av01.0.01M.10"' />
          <source media="(max-width: 1279px)" src={`${media}-loop-1280w.mp4`} type='video/mp4; codecs="avc1.64001E"' />
          <source src={`${media}-loop-1920w.webm`} type='video/webm; codecs="av01.0.04M.10"' />
          <source src={`${media}-loop-1920w.mp4`} type='video/mp4; codecs="avc1.64001F"' />
        </video>
      </div>
      <div className="igor-header__start">
        <a className="igor-brand" href={local ? '/home/' : '/igor/'} aria-label={local ? 'STEX Pantheon home' : 'Igor home'}>
          <span className="igor-brand__mark" aria-hidden="true" />
          <span className="stex-wordmark igor-wordmark">
            <span className="stex-wordmark__org"><abbr title="St. Expedite Press">STEX</abbr></span>{' '}
            <span className="stex-wordmark__name">Igor</span>
          </span>
        </a>
        {local && (
          <a className="igor-back" href="/home/">
            <span aria-hidden="true">‹</span> Pantheon
          </a>
        )}
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
        {motion.supported && (
          <button
            type="button"
            className="igor-icon-button igor-motion-toggle"
            aria-label={motion.wanted ? 'Pause motion' : 'Play motion'}
            title={motion.wanted ? 'Pause motion' : 'Play motion'}
            onClick={motion.toggle}
          >
            {motion.wanted ? <PauseIcon /> : <PlayIcon />}
          </button>
        )}
        <button type="button" className="igor-icon-button" aria-label="About Igor" onClick={onAbout}>
          <InfoIcon />
        </button>
      </div>
    </header>
  );
}
