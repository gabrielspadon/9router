export function buildProviderStrategyPatch(providerId, values) {
  return { providerStrategyPatch: { providerId, values } };
}

export async function saveProviderStrategyPatch({ fetchImpl = fetch, providerId, values }) {
  const response = await fetchImpl("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProviderStrategyPatch(providerId, values)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to save provider strategy");
  const confirmed = data.providerStrategies?.[providerId] || {};
  for (const [key, value] of Object.entries(values)) {
    const owns = Object.prototype.hasOwnProperty.call(confirmed, key);
    if ((value === null && owns) || (value !== null && (!owns || confirmed[key] !== value))) {
      throw new Error("Settings API did not confirm the provider strategy patch");
    }
  }
  return data;
}

export function createProviderStrategySaveQueue(
  save = saveProviderStrategyPatch,
  onBusyChange = () => {},
) {
  let tail = Promise.resolve();
  let pending = 0;
  return (options) => {
    pending += 1;
    if (pending === 1) onBusyChange(true);
    const current = tail
      .catch(() => {})
      .then(() => save(options))
      .finally(() => {
        pending -= 1;
        if (pending === 0) onBusyChange(false);
      });
    tail = current;
    return current;
  };
}
