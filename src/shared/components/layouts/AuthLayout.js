'use client';

import PropTypes from 'prop-types';
import Link from 'next/link';
import ThemeToggle from '../ThemeToggle';
import { APP_CONFIG } from '@/shared/constants/config';

// The shell for the public auth routes. They render outside the dashboard, so
// nothing the dashboard shell provides reaches them: this is where a logged-out
// visitor gets the skip link and the four landmarks. The banner carries the one
// control that belongs to the page rather than to the form, the footer carries
// the one public destination a visitor who cannot sign in can still reach.
export default function AuthLayout({ children }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />

      {/* First thing in the tab order, same contract as the dashboard shell:
          off-screen until it takes focus, then a 44px target at top left. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[90] focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-[var(--radius-brand)] focus:border focus:border-border focus:bg-surface focus:px-4 focus:text-sm focus:font-semibold focus:text-text-main focus:shadow-elev"
      >
        Skip to main content
      </a>

      <header className="relative z-10 flex shrink-0 items-center justify-end p-4 sm:p-5.5">
        <ThemeToggle variant="card" />
      </header>

      <main
        id="main"
        className="relative z-10 flex flex-1 flex-col items-center justify-center p-4 sm:p-5.5"
      >
        {children}
      </main>

      <footer className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-text-muted">
        <nav aria-label="About TokenProxy">
          <Link
            href="/landing"
            className="focus-ring hit-44 inline-flex items-center rounded-[var(--radius-brand)] hover:text-text-main"
          >
            What is TokenProxy?
          </Link>
        </nav>
        <span>
          {APP_CONFIG.name} v{APP_CONFIG.version}
        </span>
      </footer>
    </div>
  );
}

AuthLayout.propTypes = {
  children: PropTypes.node.isRequired,
};
