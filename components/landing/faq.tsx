import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Reveal } from "./motion";
import { SectionHeading } from "./section-heading";

/* Answers match docs/00-product-spec.md; nothing here may claim a non-goal. */
const ITEMS = [
  {
    q: "What is Personal OS?",
    a: "A personal task manager with a command bar. It keeps your tasks, reads your Gmail and Google Calendar, prepares a short briefing each morning, and lets you make changes by typing or speaking one sentence.",
  },
  {
    q: "How does the command bar work?",
    a: "Press ⌘K (or Ctrl K) and write what you want, or hold the mic and say it. Simple changes to one item happen at once and show an Undo. Bulk changes, deletes and new Gmail drafts show you exactly what will happen and wait for you to confirm. Spoken commands are never sent until you press Enter.",
  },
  {
    q: "What does it connect to?",
    a: "Google: Gmail (search and drafts) and Google Calendar (read-only). Your tasks and memory live in Personal OS itself.",
  },
  {
    q: "Does it send email?",
    a: "No — it only saves drafts for you to review.",
  },
  {
    q: "Can it change my calendar?",
    a: "No. It reads your calendar to plan around meetings but never creates, moves, accepts or declines events. If you ask it to block time, it adds a time-blocked task instead.",
  },
  {
    q: "What does the morning briefing contain?",
    a: "At 06:30 (you can change the time) it lists at most seven things that need you, your schedule for the day and a few things worth knowing. Each item links to its source, and anything it concluded rather than read is marked Inferred.",
  },
  {
    q: "What access does it ask Google for?",
    a: "Read email, create drafts and read calendar — nothing more. You can see what was granted and disconnect Google from Settings at any time; disconnecting revokes the access at Google.",
  },
  {
    q: "How do I sign in?",
    a: "With email and password plus a one-time code, with Google, with GitHub, or with a passkey.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16">
        <Reveal>
          <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions" />
        </Reveal>
        <Reveal>
          <Accordion className="border-t border-border" hiddenUntilFound>
            {ITEMS.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionPanel>{item.a}</AccordionPanel>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
