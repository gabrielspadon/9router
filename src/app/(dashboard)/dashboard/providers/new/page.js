"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/shared/components";
import { AI_PROVIDERS } from "@/shared/constants/config";
import { translate } from "@/i18n/runtime";
import AddCompatibleModal from "../components/AddCompatibleModal";

const providerOptions = Object.values(AI_PROVIDERS)
  .filter((provider) => provider?.id && provider.id !== "new")
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((provider) => ({ value: provider.id, label: provider.name }));

const compatibleKinds = [
  { variant: "openai", label: "OpenAI Compatible", detail: "Chat Completions or Responses API endpoint" },
  { variant: "anthropic", label: "Anthropic Compatible", detail: "Messages API endpoint" },
  { variant: "multi", label: "Multi-protocol Compatible", detail: "One upstream for OpenAI and Anthropic clients" },
];

export default function NewProviderPage() {
  const router = useRouter();
  const [provider, setProvider] = useState("");
  const [compatibleVariant, setCompatibleVariant] = useState(null);

  const continueToConnection = () => {
    if (provider) router.push(`/dashboard/providers/${encodeURIComponent(provider)}`);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5.5 sm:px-5.5 lg:px-8">
      <header className="border-b border-border pb-5.5">
        <Link
          href="/dashboard/providers"
          className="focus-ring inline-flex min-h-11 items-center gap-2 font-mono text-xs text-text-muted hover:text-brand"
        >
          <span aria-hidden="true" className="material-symbols-outlined dir-icon text-base">arrow_back</span>
          {translate("Back to Providers")}
        </Link>
        <p className="mt-5.5 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          {translate("Connect")}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text-main">
          {translate("Connect a Provider")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">
          {translate("Choose a catalog Provider, then add a Provider connection with its supported credential flow.")}
        </p>
      </header>

      <section aria-labelledby="catalog-provider" className="border-b border-border py-5.5">
        <div className="grid gap-5.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <h2 id="catalog-provider" className="text-base font-semibold text-text-main">
              {translate("Catalog Provider")}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {translate("Use the Provider page to choose OAuth, API key, cookie, or its own connection method.")}
            </p>
            <Select
              className="mt-4 max-w-xl"
              label={translate("Provider")}
              options={providerOptions}
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              placeholder={translate("Select a Provider")}
            />
          </div>
          <Button
            size="lg"
            disabled={!provider}
            onClick={continueToConnection}
            icon="arrow_forward"
          >
            {translate("Continue to connection")}
          </Button>
        </div>
      </section>

      <section aria-labelledby="compatible-provider" className="py-5.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
          {translate("Endpoint")}
        </p>
        <h2 id="compatible-provider" className="mt-2 text-base font-semibold text-text-main">
          {translate("Add a compatible upstream")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          {translate("Register the endpoint first. You can add its Provider connections immediately after validation.")}
        </p>
        <div className="mt-5.5 grid gap-px border border-border bg-border sm:grid-cols-3">
          {compatibleKinds.map((kind) => (
            <button
              key={kind.variant}
              type="button"
              onClick={() => setCompatibleVariant(kind.variant)}
              className="focus-ring min-h-28 bg-surface px-4 py-4 text-start transition-colors duration-150 hover:bg-surface-2"
            >
              <span className="block text-sm font-semibold text-text-main">{translate(kind.label)}</span>
              <span className="mt-2 block text-xs leading-relaxed text-text-muted">{translate(kind.detail)}</span>
            </button>
          ))}
        </div>
      </section>

      {compatibleVariant ? (
        <AddCompatibleModal
          variant={compatibleVariant}
          isOpen
          onClose={() => setCompatibleVariant(null)}
          onCreated={(node) => router.push(`/dashboard/providers/${encodeURIComponent(node.id)}`)}
        />
      ) : null}
    </div>
  );
}
