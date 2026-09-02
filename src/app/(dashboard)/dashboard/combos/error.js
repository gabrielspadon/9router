"use client";

import { useEffect } from "react";
import Link from "next/link";
import PropTypes from "prop-types";

export default function CombosError({ error, reset }) {
  useEffect(() => {
    console.error("Combos page error:", error);
  }, [error]);

  return (
    <section
      role="alert"
      aria-labelledby="combos-error-title"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 py-20 text-center"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-4xl text-warning"
      >
        warning
      </span>
      <div className="space-y-2">
        <h1 id="combos-error-title" className="text-lg font-semibold text-text-main">
          Something went wrong
        </h1>
        <p className="text-sm text-text-muted">
          The combos page failed to load. Try again, or return to the dashboard.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="focus-ring rounded-[var(--radius-brand)] bg-brand-solid px-4 py-2 text-sm font-medium text-brand-on hover:bg-brand-solid-hover"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="focus-ring rounded-[var(--radius-brand)] border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-surface-2"
        >
          Back to Dashboard
        </Link>
      </div>
    </section>
  );
}

CombosError.propTypes = {
  error: PropTypes.instanceOf(Error).isRequired,
  reset: PropTypes.func.isRequired,
};
