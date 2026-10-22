import { Plate } from "../kit/react/draw";
import { FigureStage } from "../shared/stage";
import { SorterArt } from "./art";
import "./sorter.css";
import { END, NEED_TOTAL, TOTAL, countsAt, readoutOf, spokenOf } from "./model";

export function SorterFigure() {
  const done = countsAt(END);
  return (
    <Plate
      fig="Fig 1"
      title="Morning sort"
      hint="Move across to sort ← →"
      readout={readoutOf(END)}
      keys={[
        { mark: "raised", label: "Needs you today" },
        { mark: "flat", label: "Filed for later" },
        { mark: "lit", label: "Being sorted now" },
      ]}
      caption={`At 06:30 the briefing reads ${TOTAL} items from your tasks, Gmail and Calendar. ${NEED_TOTAL} need you today and reach the shelf, which never holds more than seven; the other ${Math.round(done.pile)} go to the bin for later.`}
    >
      <FigureStage
        kind="sorter"
        role="slider"
        aria-label="Morning sort. Use the arrow keys to run the sort back and forth."
        aria-valuemin={0}
        aria-valuemax={TOTAL}
        aria-valuenow={done.seen}
        aria-valuetext={spokenOf(END)}
      >
        <SorterArt />
      </FigureStage>
    </Plate>
  );
}
