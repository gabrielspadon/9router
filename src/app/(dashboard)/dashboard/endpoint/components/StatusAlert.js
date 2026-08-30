"use client";

// Every alert tone is a status, so each one carries its glyph and its live
// region politeness alongside the token. See TOKEN-CONTRACT.md section 1.
const TONES = {
  success: { box: "bg-success-soft border-success-line text-success", icon: "check_circle", live: "status" },
  warning: { box: "bg-warning-soft border-warning-line text-warning", icon: "warning", live: "status" },
  info: { box: "bg-info-soft border-info-line text-info", icon: "info", live: "status" },
  error: { box: "bg-danger-soft border-danger-line text-danger", icon: "error", live: "alert" },
};

/** Reusable status alert */
export default function StatusAlert({ status, className = "" }) {
  const tone = TONES[status.type] || TONES.error;

  const renderMessage = (msg) => {
    const parts = msg.split(/(https?:\/\/[^\s]+)/g);
    return parts.map((part, i) =>
      /^https?:\/\//.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline font-medium">{part}</a>
        : part
    );
  };

  return (
    <div role={tone.live} className={`flex items-start gap-2 p-2 rounded border text-sm ${className} ${tone.box}`}>
      <span className="material-symbols-outlined shrink-0 text-[16px] leading-5" aria-hidden="true">
        {tone.icon}
      </span>
      <span className="min-w-0 break-words">{renderMessage(status.message)}</span>
    </div>
  );
}
