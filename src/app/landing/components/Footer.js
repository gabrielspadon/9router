"use client";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-bg-alt pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-6 rounded bg-brand-solid flex items-center justify-center text-brand-on" aria-hidden="true">
                <span className="material-symbols-outlined text-[16px]">hub</span>
              </div>
              <h3 className="text-text-main text-lg font-bold">9Router</h3>
            </div>
            <p className="text-text-muted text-sm max-w-xs mb-6">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers with ease.
            </p>
            <div className="flex gap-4">
              <a
                className="focus-ring rounded text-text-muted hover:text-text-main transition-colors duration-150"
                href="https://github.com/decolua/9router"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="9Router source on GitHub"
              >
                <span className="material-symbols-outlined" aria-hidden="true">code</span>
              </a>
            </div>
          </div>
          
          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Product</h4>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="#features">Features</a>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="/dashboard">Dashboard</a>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">Changelog</a>
          </div>
          
          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Resources</h4>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="https://github.com/decolua/9router#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
          
          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-text-main">Legal</h4>
            <a className="focus-ring rounded text-text-muted hover:text-brand text-sm transition-colors duration-150" href="https://github.com/decolua/9router/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-text-muted text-sm">© 2025 9Router. All rights reserved.</p>
          <div className="flex gap-6">
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm transition-colors duration-150" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="focus-ring rounded text-text-muted hover:text-text-main text-sm transition-colors duration-150" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

