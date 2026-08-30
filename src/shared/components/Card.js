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
  // Densities from docs/design/design-system.md section 3. They do not vary by
  // route: a route that needs a different density is a finding, not a prop.
  const paddings = {
    none: "",
    xs: "p-3",
    sm: "p-4",
    md: "p-5",
    lg: "p-6",
  };

  return (
    <div
      className={cn(
        // One elevation step for every raised surface in the product. Only an
        // overlay (Modal, Drawer) is allowed a second one.
        "bg-surface border border-border rounded-[var(--radius-brand-lg)] shadow-soft",
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
                <h3 className="text-sm font-semibold text-text-main">{title}</h3>
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
