"use client";
import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";

export default function LandingPage() {
  const router = useRouter();
  return (
    <div className="dark relative min-h-screen bg-bg text-text-main font-sans overflow-x-hidden antialiased">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-bg">
        {/* Grid pattern */}
        <div className="landing-grid absolute inset-0"></div>

        {/* Brand glow. Decorative, fixed composition: left-1/4 stays physical,
            the same call made in AnimatedBackground.js. */}
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-brand-500/12 rounded-full blur-[130px]"></div>

        {/* Vignette effect */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(circle at center, transparent 0%, color-mix(in srgb, var(--color-bg) 40%, transparent) 100%)'
        }}></div>
      </div>

      <div className="relative z-10">
        <Navigation />
        
        <main>
          {/* Hero with Flow Animation */}
          <div className="relative">
          <HeroSection />
          <div className="flex justify-center pb-20">
            <FlowAnimation />
          </div>
        </div>
        
        <GetStarted />
        <HowItWorks />
        <Features />
        
        {/* CTA Section */}
        <section className="py-32 px-5.5 relative overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-t from-brand-500/5 to-transparent pointer-events-none"></div>
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-4xl md:text-5xl font-black mb-5.5">Ready to Simplify Your AI Infrastructure?</h2>
            <p className="text-xl text-text-muted mb-8 max-w-2xl mx-auto">
              Join developers who are streamlining their AI integrations with TokenProxy. Open source and free to start.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="focus-ring w-full sm:w-auto h-14 px-8 rounded-lg bg-brand-solid hover:bg-brand-solid-hover text-brand-on text-lg font-bold transition-colors duration-150"
              >
                Start Free
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard/skills")}
                className="focus-ring w-full sm:w-auto h-14 px-8 rounded-lg border border-border hover:bg-surface text-text-main text-lg font-bold transition-colors duration-150"
              >
                Agent Skills
              </button>
            </div>
          </div>
        </section>
        </main>
        
        <Footer />
      </div>
      
      {/* Global styles for keyframes */}
      <style jsx global>{`
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
      `}</style>
    </div>
  );
}

