import type { DailyBriefing } from '@/db/schema';

export function BriefingView({ briefing }: { briefing: DailyBriefing | null }) {
  if (!briefing) {
    return <p>Your briefing is being prepared — check back shortly.</p>;
  }
  const attentionItems = briefing.attentionItems as string[];
  const digestItems = briefing.digestItems as string[];
  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold">What needs your attention</h2>
        <ul>{attentionItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
      <section>
        <h2 className="font-semibold">Things to know</h2>
        <ul>{digestItems.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  );
}
