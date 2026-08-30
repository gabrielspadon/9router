export function buildProviderStrategyPatch(providerId, values) {
  return { providerStrategyPatch: { providerId, values } };
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isPlainMap(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertProviderStrategyPatchConfirmation(
  data,
  providerId,
  values,
  message = "Settings API did not confirm the provider strategy patch",
) {
  if (
    !isPlainMap(data)
    || !hasOwn(data, "providerStrategies")
    || !isPlainMap(data.providerStrategies)
  ) {
    throw new Error(message);
  }
  const strategies = data.providerStrategies;
  const hasProvider = hasOwn(strategies, providerId);
  const confirmed = hasProvider ? strategies[providerId] : Object.create(null);
  if (hasProvider && !isPlainMap(confirmed)) throw new Error(message);

  for (const [key, value] of Object.entries(values)) {
    const owns = hasOwn(confirmed, key);
    if ((value === null && owns) || (value !== null && (!owns || confirmed[key] !== value))) {
      throw new Error(message);
    }
  }
  return confirmed;
}

export async function saveProviderStrategyPatch({ fetchImpl = fetch, providerId, values }) {
  const response = await fetchImpl("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildProviderStrategyPatch(providerId, values)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Failed to save provider strategy");
  assertProviderStrategyPatchConfirmation(data, providerId, values);
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
      .then(async () => {
        const { onSuccess, onError, ...saveOptions } = options;
        let result;
        try {
          result = await save(saveOptions);
        } catch (error) {
          await onError?.(error);
          throw error;
        }
        await onSuccess?.(result);
        return result;
      })
      .finally(() => {
        pending -= 1;
        if (pending === 0) onBusyChange(false);
      });
    tail = current;
    return current;
  };
}
