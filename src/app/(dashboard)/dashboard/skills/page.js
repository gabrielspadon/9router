"use client";

import { Card, Badge, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { SKILLS, getSkillRawUrl } from "@/shared/constants/skills";

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <Button
      size="sm"
      icon={copied ? "check" : "content_copy"}
      onClick={() => copy(value)}
      className="shrink-0"
      title={value}
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[var(--radius-brand-lg)] border transition-colors duration-150 ${
        skill.isEntry
          ? "border-brand-line bg-brand-soft"
          : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-[var(--radius-brand)] flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-brand-solid text-brand-on" : "bg-surface-2 text-text-muted"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{skill.icon}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-text-main">{skill.name}</h3>
          {skill.isEntry && (
            <Badge variant="brand" size="sm">START HERE</Badge>
          )}
          {skill.endpoint && (
            <Badge variant="neutral" size="sm">
              <code className="font-mono text-[10.5px]">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-1">{skill.description}</p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="focus-ring hit-44 rounded-sm text-xs text-text-muted hover:text-brand transition-colors duration-150 mt-1 inline-flex items-center gap-1 break-all"
        >
          {url}
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">open_in_new</span>
        </a>
      </div>

      <CopyButton value={url} />
    </div>
  );
}

export default function SkillsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-5.5">
      <Card padding="md">
        <div className="text-xs text-text-muted mb-2">Paste this to your AI:</div>
        <div className="px-4 py-3 rounded-[var(--radius-brand)] bg-surface-2 font-mono text-xs text-text-main break-all">
          Read this skill and use it: {getSkillRawUrl("tokenproxy")}
        </div>
      </Card>

      <div className="space-y-4">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
        ))}
      </div>

    </div>
  );
}
