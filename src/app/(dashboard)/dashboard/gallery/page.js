import {
  Button,
  Badge,
  Card,
  Input,
  Select,
  Toggle,
  Skeleton,
  EmptyState,
  ErrorState,
  StatusToken,
  Readout,
  DataTable,
  THead,
  TH,
  TBody,
  TR,
  TD,
  ChannelList,
  Channel,
} from "@/shared/components";

// The component gallery. Every primitive in every state it is allowed to be in,
// on one page, so a regression is visible in a single snapshot rather than
// hunted across twenty routes.
//
// Deliberately a server component with no handlers anywhere. A gallery exists to
// be looked at and photographed; giving it behaviour would make it a page that
// can drift from the components it documents.

export const metadata = { title: "Component gallery" };

function Section({ id, title, note, children }) {
  return (
    <section id={id} className="border-t border-border pt-6">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          {title}
        </h2>
        {note ? (
          <p className="max-w-prose text-right text-[11px] text-text-subtle">{note}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

function Bay({ label, children }) {
  return (
    <div className="min-w-[180px]">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-subtle">
        {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-6 py-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
          Design system
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-text-main">
          Component gallery
        </h1>
        <p className="max-w-prose text-sm text-text-muted">
          Every primitive in every state. The authority for how these look is
          docs/design/design-system.md; where a component and that document
          disagree, the component is wrong.
        </p>
      </header>

      <Section
        id="buttons"
        title="Button"
        note="Closed variant set. Brand carries the primary action, danger carries destruction, nothing else is coloured."
      >
        <Bay label="Variant">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
        </Bay>
        <Bay label="Size">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Bay>
        <Bay label="Disabled">
          <Button variant="primary" disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
          <Button variant="danger" disabled>Danger</Button>
        </Bay>
        <Bay label="Icon only, named">
          <Button size="icon" aria-label="Copy endpoint">
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Dismiss">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </Button>
        </Bay>
      </Section>

      <Section id="status" title="Status token" note="Colour is paired with a glyph and a word, so status survives colour blindness and a monochrome screenshot.">
        <Bay label="Tone">
          <StatusToken tone="ok">ok</StatusToken>
          <StatusToken tone="degraded">degraded</StatusToken>
          <StatusToken tone="failing">429 rate limit</StatusToken>
          <StatusToken tone="idle">idle</StatusToken>
          <StatusToken tone="active">carrying</StatusToken>
          <StatusToken tone="info">syncing</StatusToken>
        </Bay>
      </Section>

      <Section id="badge" title="Badge">
        <Bay label="Variant">
          <Badge variant="neutral">neutral</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
        </Bay>
        <Bay label="Solid">
          <Badge variant="success" solid>success</Badge>
          <Badge variant="danger" solid>danger</Badge>
        </Bay>
      </Section>

      <Section id="readout" title="Readout" note="Large type is reserved for a number that answers a question. Quantities are tabular.">
        <Bay label="Size and tone">
          <div className="flex flex-wrap gap-8 border border-border bg-surface px-4 py-3">
            <Readout label="Throughput" value="312" unit="req/min" />
            <Readout label="p95 latency" value="1.84" unit="s" />
            <Readout label="Error rate" value="4.1" unit="%" tone="danger" />
            <Readout label="Connected" value="6" tone="accent" />
          </div>
        </Bay>
      </Section>

      <Section id="table" title="Table" note="Structure, not card chrome. Numeric columns are tabular and right aligned.">
        <div className="w-full border border-border bg-surface px-4 py-3">
          <DataTable>
            <THead>
              <TR>
                <TH>Upstream</TH>
                <TH>Channel</TH>
                <TH numeric>req</TH>
                <TH numeric>p95</TH>
                <TH>State</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD mono>claude-code</TD>
                <TD mono>1 primary</TD>
                <TD numeric>1,204</TD>
                <TD numeric>1.6s</TD>
                <TD><StatusToken tone="ok">ok</StatusToken></TD>
              </TR>
              <TR tone="danger">
                <TD mono>openai-codex</TD>
                <TD mono>2 fallback</TD>
                <TD numeric>388</TD>
                <TD numeric>6.9s</TD>
                <TD><StatusToken tone="failing">429</StatusToken></TD>
              </TR>
              <TR>
                <TD mono>antigravity</TD>
                <TD mono>3 fallback</TD>
                <TD numeric>211</TD>
                <TD numeric>2.1s</TD>
                <TD><StatusToken tone="idle">idle</StatusToken></TD>
              </TR>
            </TBody>
          </DataTable>
        </div>
      </Section>

      <Section id="channels" title="Channel list" note="A combo's fallback order drawn as the sequence it is. The number is the channel's stable address.">
        <div className="w-full max-w-[560px]">
          <ChannelList>
            <Channel
              index={1}
              title="openai-codex"
              subtitle="acct-01 · gpt-5-codex"
              state="failing"
              status={<StatusToken tone="failing">429</StatusToken>}
            />
            <Channel
              index={2}
              title="claude-code"
              subtitle="acct-01 · sonnet"
              state="live"
              status={<StatusToken tone="active">carrying</StatusToken>}
            />
            <Channel
              index={3}
              title="antigravity"
              subtitle="acct-02 · gemini"
              state="standby"
              status={<StatusToken tone="idle">standby</StatusToken>}
            />
          </ChannelList>
        </div>
      </Section>

      <Section id="fields" title="Input, Select and Toggle">
        <Bay label="Input">
          <div className="w-[220px] space-y-3">
            <Input label="Endpoint" placeholder="http://localhost:20128/v1" />
            <Input label="Disabled" placeholder="Not editable" disabled />
          </div>
        </Bay>
        <Bay label="Select">
          <div className="w-[220px]">
            <Select
              label="Period"
              options={[
                { value: "24h", label: "Last 24 hours" },
                { value: "7d", label: "Last 7 days" },
              ]}
            />
          </div>
        </Bay>
        <Bay label="Toggle">
          <div className="space-y-3">
            <Toggle checked label="Require API key" description="Requests without a valid key are rejected" />
            <Toggle label="Auto fetch free models" />
            <Toggle checked disabled label="Disabled" />
          </div>
        </Bay>
      </Section>

      <Section id="states" title="Empty, error and loading">
        <div className="w-[320px]">
          <EmptyState
            title="No custom providers"
            description="Add one to route traffic through an upstream 9Router does not ship with."
            action={<Button size="sm">Add provider</Button>}
          />
        </div>
        <div className="w-[320px]">
          <ErrorState
            title="openai-codex is rate limited"
            description="Channel 1 is failing. Traffic is held on channel 2."
            detail="429 rate_limit_exceeded · retry after 41s"
            action={<Button size="sm">Enable acct-02</Button>}
          />
        </div>
        <div className="w-[260px] border border-border bg-surface px-4 py-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-subtle">
            Skeleton
          </div>
          <Skeleton className="h-6 w-[55%]" />
          <div className="h-3" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="mb-2 h-4 w-full" />
          <Skeleton className="h-4 w-[62%]" />
        </div>
      </Section>

      <Section id="card" title="Card" note="Reserved for a genuinely portable object. A page section is not a card.">
        <Card className="w-[280px]">
          <div className="space-y-1">
            <p className="text-sm font-medium text-text-main">Default key</p>
            <p className="font-mono text-[11px] text-text-muted">sk-4b9…482c</p>
          </div>
        </Card>
      </Section>
    </div>
  );
}
