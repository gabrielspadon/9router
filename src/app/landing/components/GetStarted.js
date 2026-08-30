"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (text) => {
    copy(text, "landing");
  };

  return (
    <section className="py-24 px-6 bg-bg-alt">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Get Started in 30 Seconds</h2>
            <p className="text-text-muted text-lg mb-8">
              Install 9Router, configure your providers via web dashboard, and start routing AI requests.
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-soft text-brand flex items-center justify-center font-bold" aria-hidden="true">1</div>
                <div>
                  <h4 className="font-bold text-lg">Install 9Router</h4>
                  <p className="text-sm text-text-muted mt-1">Run npx command to start the server instantly</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-soft text-brand flex items-center justify-center font-bold" aria-hidden="true">2</div>
                <div>
                  <h4 className="font-bold text-lg">Open Dashboard</h4>
                  <p className="text-sm text-text-muted mt-1">Configure providers and API keys via web interface</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-soft text-brand flex items-center justify-center font-bold" aria-hidden="true">3</div>
                <div>
                  <h4 className="font-bold text-lg">Route Requests</h4>
                  <p className="text-sm text-text-muted mt-1">Point your CLI tools to http://localhost:20128</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-surface border border-border shadow-soft">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-surface-2 border-b border-border">
                <div className="w-3 h-3 rounded-full bg-surface-3" aria-hidden="true"></div>
                <div className="w-3 h-3 rounded-full bg-surface-3" aria-hidden="true"></div>
                <div className="w-3 h-3 rounded-full bg-surface-3" aria-hidden="true"></div>
                <div className="ml-2 text-xs text-text-muted font-mono">terminal</div>
              </div>
              
              {/* Terminal content */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <button
                  type="button"
                  className="focus-ring rounded w-full text-left flex items-center gap-2 mb-4 group cursor-pointer"
                  aria-label="Copy npx 9router to the clipboard"
                  onClick={() => handleCopy("npx 9router")}
                >
                  <span className="text-text-muted" aria-hidden="true">$</span>
                  <span className="text-text-main">npx 9router</span>
                  <span className="ml-auto text-text-muted text-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                    {copied === "landing" ? "✓ Copied" : "Copy"}
                  </span>
                </button>
                
                <div className="text-text-muted mb-6">
                  <span className="text-brand" aria-hidden="true">&gt;</span> Starting 9Router...<br/>
                  <span className="text-brand" aria-hidden="true">&gt;</span> Server running on <span className="text-text-main">http://localhost:20128</span><br/>
                  <span className="text-brand" aria-hidden="true">&gt;</span> Dashboard: <span className="text-text-main">http://localhost:20128/dashboard</span><br/>
                  <span className="text-success" aria-hidden="true">&gt;</span> <span className="text-success">Ready to route! ✓</span>
                </div>
                
                <div className="text-xs text-text-muted mb-2 border-t border-border pt-4">
                  📝 Configure providers in dashboard or use environment variables
                </div>
                
                <div className="text-text-muted text-xs">
                  <span className="text-text-main font-semibold">Data Location:</span><br/>
                  <span className="text-text-muted">  macOS/Linux:</span> ~/.9router/db/data.sqlite<br/>
                  <span className="text-text-muted">  Windows:</span> %APPDATA%/9router/db/data.sqlite
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

