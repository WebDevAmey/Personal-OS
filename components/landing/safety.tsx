import { DecisionTree } from "./decision-tree";
import { SplitHeading } from "./features";
import { Reveal } from "./motion";

export function Safety() {
  return (
    <section id="safety" aria-labelledby="safety-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <SplitHeading
            id="safety-title"
            eyebrow="Safety"
            title={
              <>
                Nothing risky runs
                <br />
                <em className="italic text-muted-foreground">without you.</em>
              </>
            }
          >
            One small, reversible change happens at once. Bulk changes, deletes and new drafts wait for you with exactly what will change. Try it.
          </SplitHeading>
        </Reveal>
        <Reveal className="mt-14">
          <DecisionTree />
        </Reveal>
      </div>
    </section>
  );
}
