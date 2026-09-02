"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import PricingModal from "@/shared/components/PricingModal";

export default function PricingSettingsPage() {
  const [showModal, setShowModal] = useState(false);
  const [currentPricing, setCurrentPricing] = useState(null);
  const [loading, setLoading] = useState(true);

  // Declared before the effect that calls it, and memoised so the dependency
  // list can name it honestly. It used to sit below a `useEffect(..., [])` that
  // called it, which reads the identifier during render before its `const` is
  // initialised and hides a stale closure behind an empty dependency array.
  //
  // It also sets no state before its first await, so the effect below does not
  // cascade a render. Whether to show the spinner is the caller's decision, and
  // an event handler is the right place to make it.
  const loadPricing = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    // `loading` already starts true, so the first read does not need to set it.
    // The await is inside the effect rather than behind a call, so nothing sets
    // state before React has yielded.
    void (async () => {
      await loadPricing();
    })();
  }, [loadPricing]);

  const handlePricingUpdated = () => {
    setLoading(true);
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
    <div className="space-y-5.5">
      <div className="flex justify-end">
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
      <Card padding="none" className="p-5.5">
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
          <ul className="list-disc list-inside ms-4 space-y-1">
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
      <Card padding="none" className="p-5.5">
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