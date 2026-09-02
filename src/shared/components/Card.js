"use client";

import { cn } from "@/shared/utils/cn";

export default function Card({
  children,
  title,
  subtitle,
  icon,
  action,
  padding = "md",
  hover = false,
  className,
  ...props
}) {
  // Densities per the spacing-scale test in
  // tests/unit/design-system-rules.test.js. They do not vary by route: a route
  // that needs a different density is a finding, not a prop.
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-5.5",
    lg: "p-8",
  };

  return (
    <div
      className={cn(
        // design-system.md section 4: "Elevation is expressed by ground, line and
        // inset, not by shadow. One shadow token remains, a single hairline for
        // a genuinely floating layer such as a modal or a popover. Ambient drop
        // shadows on static regions are removed." A Card is a static region, so
        // it carries ground and line and no shadow; `shadow-elev` stays for the
        // overlays (Modal, Drawer, HeaderMenu) that actually float.
        "bg-surface border border-border rounded-[var(--radius-brand-lg)]",
        hover && "hover:border-brand-line transition-colors duration-150 cursor-pointer",
        paddings[padding],
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-[var(--radius-brand)] bg-bg text-text-muted">
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">{icon}</span>
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-semibold text-text-main">{title}</h2>
              )}
              {subtitle && (
                <p className="text-xs text-text-muted">{subtitle}</p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

Card.Section = function CardSection({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-4 rounded-[var(--radius-brand)]",
        "bg-bg border border-border",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.Row = function CardRow({ children, className, ...props }) {
  return (
    <div
      className={cn(
        "p-3 -mx-3 px-3 transition-colors",
        "border-b border-border last:border-b-0",
        "hover:bg-surface-2/50",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

Card.ListItem = function CardListItem({
  children,
  actions,
  className,
  ...props
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between p-3 -mx-3 px-3",
        "border-b border-border last:border-b-0",
        "hover:bg-surface-2/50 transition-colors",
        className
      )}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {actions && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
      )}
    </div>
  );
};
