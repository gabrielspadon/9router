const UNKNOWN_MODEL_PREDICATES = {
  gemini: ({ requestedModel, status, payload }) => {
    const error = payload?.error;
    return Number(status) === 404
      && Number(error?.code) === 404
      && error?.status === "NOT_FOUND"
      && typeof error?.message === "string"
      && error.message.startsWith(`models/${requestedModel} is not found`);
  },
};

/**
 * Project a client-visible status without changing the raw upstream result.
 * A 404 is accepted only from a provider-specific structured signature that
 * identifies the exact requested model.
 */
export function projectClientModelStatus({ provider, requestedModel, status, payload }) {
  const predicate = UNKNOWN_MODEL_PREDICATES[provider];
  const unknownModelVerified = Boolean(predicate?.({ requestedModel, status, payload }));
  return {
    clientErrorStatus: unknownModelVerified ? 404 : status,
    unknownModelVerified,
  };
}
