"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/pricing");
      if (response.ok) {
        const data = await response.json();
        setCurrentPricing(data);
      }
    } catch (error) {
      console.error("Failed to load pricing:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePricingUpdated = () => {
    loadPricing();
  };

  // Count total models with pricing
  const getModelCount = () => {
    if (!currentPricing) return 0;
    let count = 0;
    for (const provider in currentPricing) {
      count += Object.keys(currentPricing[provider]).length;
    }
    return count;
  };

  // Get providers list
  const getProviders = () => {
    if (!currentPricing) return [];
    return Object.keys(currentPricing).sort();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-main">Pricing Settings</h1>
          <p className="text-xs text-text-muted mt-1">
            Configure pricing rates for cost tracking and calculations
          </p>
        </div>
        <Button
          variant="primary"
          icon="edit"
          className="focus-ring"
          onClick={() => setShowModal(true)}
        >
          Edit Pricing
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="sm">
          <div className="text-xs text-text-muted">Total Models</div>
          <div className="text-lg font-semibold text-text-main metric mt-1">
            {loading ? "..." : getModelCount()}
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-xs text-text-muted">Providers</div>
          <div className="text-lg font-semibold text-text-main metric mt-1">
            {loading ? "..." : getProviders().length}
          </div>
        </Card>
        <Card padding="sm">
          <div className="text-xs text-text-muted">Status</div>
          <div className="flex items-center gap-1.5 text-lg font-semibold text-success mt-1">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              check_circle
            </span>
            {loading ? "..." : "Active"}
          </div>
        </Card>
      </div>

      {/* Info Section */}
      <Card padding="none" className="p-5">
        <h2 className="text-sm font-semibold text-text-main mb-4">How Pricing Works</h2>
        <div className="space-y-3 text-sm text-text-muted">
          <p>
            <strong>Cost Calculation:</strong> Costs are calculated based on token usage and pricing rates.
            Each request&apos;s cost is determined by: (input_tokens × input_rate) + (output_tokens × output_rate) + (cached_tokens × cached_rate)
          </p>
          <p>
            <strong>Pricing Format:</strong> All rates are in <strong>dollars per million tokens</strong> ($/1M tokens).
            Example: An input rate of 2.50 means $2.50 per 1,000,000 input tokens.
          </p>
          <p>
            <strong>Token Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Input:</strong> Standard prompt tokens</li>
            <li><strong>Output:</strong> Completion/response tokens</li>
            <li><strong>Cached:</strong> Cached input tokens (typically 50% of input rate)</li>
            <li><strong>Reasoning:</strong> Special reasoning/thinking tokens (fallback to output rate)</li>
            <li><strong>Cache Creation:</strong> Tokens used to create cache entries (fallback to input rate)</li>
          </ul>
          <p>
            <strong>Custom Pricing:</strong> You can override default pricing for specific models.
            Reset to defaults anytime to restore standard rates.
          </p>
        </div>
      </Card>

      {/* Current Pricing Preview */}
      <Card padding="none" className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-sm font-semibold text-text-main min-w-0">Current Pricing Overview</h2>
          <Button
            variant="ghost"
            size="sm"
            className="focus-ring"
            onClick={() => setShowModal(true)}
          >
            View Full Details
          </Button>
        </div>

        {loading ? (
          <div className="text-center py-4 text-sm text-text-muted">Loading pricing data...</div>
        ) : currentPricing ? (
          <div className="space-y-3">
            {Object.keys(currentPricing).slice(0, 5).map(provider => (
              <div key={provider} className="text-sm text-text-main">
                <span className="font-semibold">{provider.toUpperCase()}</span>{" "}
                <span className="text-text-muted">
                  <span className="metric">{Object.keys(currentPricing[provider]).length}</span> models
                </span>
              </div>
            ))}
            {Object.keys(currentPricing).length > 5 && (
              <div className="text-sm text-text-muted">
                + <span className="metric">{Object.keys(currentPricing).length - 5}</span> more providers
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-text-muted">No pricing data available</div>
        )}
      </Card>

      {/* Pricing Modal */}
      {showModal && (
        <PricingModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSave={handlePricingUpdated}
        />
      )}
    </div>
  );
}