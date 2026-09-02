"use client";

/** Security warning banner with optional action link */
export default function SecurityWarning({ message, action }) {
  return (
    <div role="alert" className="flex items-start gap-2 px-3 py-2 rounded-lg bg-warning-soft border border-warning-line text-warning">
      <span className="material-symbols-outlined text-[16px] shrink-0 mt-1" aria-hidden="true">warning</span>
      <p className="text-xs flex-1 min-w-0">{message}</p>
      {action && (
        <a
          href={action.href}
          className="focus-ring hit-44 rounded text-xs font-medium underline shrink-0 hover:no-underline"
          onClick={action.href.startsWith("#") ? (e) => {
            e.preventDefault();
            document.getElementById(action.href.slice(1))?.scrollIntoView({ behavior: "smooth" });
          } : undefined}
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
