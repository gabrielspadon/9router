"use client";

export default function HowItWorks() {
  return (
    <section className="py-24 border-y border-border bg-surface/30" id="how-it-works">
      <div className="max-w-7xl mx-auto px-5.5">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">How TokenProxy Works</h2>
          <p className="text-text-muted max-w-xl text-lg">
            Data flows seamlessly from your application through our intelligent routing layer to the best provider for the job.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connection line */}
          <div className="hidden md:block absolute top-12 start-[16%] end-[16%] h-[2px] bg-linear-to-r from-border via-brand-500 to-border -z-10"></div>
          
          {/* Step 1: CLI & SDKs */}
          <div className="flex flex-col gap-5.5 relative group">
            <div className="w-24 h-24 rounded-2xl bg-bg border border-border flex items-center justify-center group-hover:border-brand-500/40 transition-colors duration-150 z-10 mx-auto md:mx-0">
              <span className="material-symbols-outlined text-4xl text-text-muted" aria-hidden="true">terminal</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">1. CLI &amp; SDKs</h3>
              <p className="text-sm text-text-muted">
                Your requests start from your favorite tools or our unified SDK. Just change the base URL.
              </p>
            </div>
          </div>

          {/* Step 2: TokenProxy Hub */}
          <div className="flex flex-col gap-5.5 relative group md:items-center md:text-center">
            <div className="w-24 h-24 rounded-2xl bg-bg border-2 border-brand-500 flex items-center justify-center z-10 mx-auto">
              <span className="material-symbols-outlined text-4xl text-brand" aria-hidden="true">hub</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-brand">2. TokenProxy Hub</h3>
              <p className="text-sm text-text-muted">
                Our engine analyzes the prompt, checks provider health, and routes for lowest latency or cost.
              </p>
            </div>
          </div>

          {/* Step 3: AI Providers */}
          <div className="flex flex-col gap-5.5 relative group md:items-end md:text-end">
            <div className="w-24 h-24 rounded-2xl bg-bg border border-border flex items-center justify-center group-hover:border-brand-500/40 transition-colors duration-150 z-10 mx-auto md:mx-0">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-6 h-6 rounded bg-surface-2"></div>
                <div className="w-6 h-6 rounded bg-surface-2"></div>
                <div className="w-6 h-6 rounded bg-surface-2"></div>
                <div className="w-6 h-6 rounded bg-surface-2"></div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">3. AI Providers</h3>
              <p className="text-sm text-text-muted">
                The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

