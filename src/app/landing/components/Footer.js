"use client";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-bg-alt pt-16 pb-8 px-5.5">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-5.5">
              <div className="size-6 rounded bg-brand-solid flex items-center justify-center text-brand-on" aria-hidden="true">
                <span aria-hidden="true" className="material-symbols-outlined text-[16px]">hub</span>
              </div>
              <h3 className="text-text-main text-lg font-bold">TokenProxy</h3>
            </div>
            <p className="text-text-muted text-sm max-w-xs mb-5.5">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers with ease.
            </p>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Product</h4>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="#features">Features</a>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="/dashboard">Dashboard</a>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="/api/changelog">Changelog</a>
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Resources</h4>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="/dashboard/skills">Agent Skills</a>
            <a className="focus-ring hit-44 rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="/dashboard/settings">Settings</a>
          </div>

          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Legal</h4>
            <span className="text-text-muted text-sm">MIT License</span>
          </div>
        </div>

        {/* Bottom */}
        <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-text-muted text-sm">TokenProxy. Released under the MIT License.</p>
        </div>
      </div>
    </footer>
  );
}
