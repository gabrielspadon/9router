import PropTypes from "prop-types";
import { Button, CapacityBadges } from "@/shared/components";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
  const borderColor = testStatus === "ok"
    ? "border-success-line"
    : testStatus === "error"
    ? "border-danger-line"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span aria-hidden="true"
          className="material-symbols-outlined shrink-0 text-sm"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">{displayModel}</code>
          <span className="flex min-w-0 items-center text-xs gap-1 pl-1">
            {model.name && <span className="truncate text-xs italic text-text-subtle">{model.name}</span>}
            <CapacityBadges caps={caps} colorOverride="text-text-subtle" size={12} />
          </span>
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <Button
              variant="bare" size="icon-sm"
              onClick={onTest}
              disabled={isTesting}
              title={isTesting ? "Testing model" : "Test model"}
              aria-label={isTesting ? "Testing model" : "Test model"}
              className={`text-text-muted transition-opacity hover:bg-sidebar hover:text-brand ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </Button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <Button
            variant="bare" size="icon-sm"
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            title={copied === `model-${model.id}` ? "Copied" : "Copy model id"}
            aria-label={copied === `model-${model.id}` ? "Copied" : "Copy model id"}
            className="text-text-muted hover:bg-sidebar hover:text-brand"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </Button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <Button
            variant="bare" size="icon-sm"
            onClick={onDeleteAlias}
            className="ml-auto text-text-muted opacity-100 transition-opacity hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">close</span>
          </Button>
        ) : onDisable ? (
          <Button
            variant="bare" size="icon-sm"
            onClick={onDisable}
            className="ml-auto text-text-muted opacity-100 transition-opacity hover:bg-danger-soft hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
            title="Disable this model"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">close</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
