import { Plate } from "../kit/react/draw";
import { FigureStage } from "../shared/stage";
import { StampArt } from "./art";
import "./stamp.css";
import { END, STOPS, TARGET, TODAY, WORD, printed, stageOf, readoutOf, spoken, spokenOf } from "./model";

export function StampFigure() {
  return (
    <Plate
      fig="Fig 2"
      title="Date stamp"
      hint="Move across to replay ← →"
      readout={readoutOf(END)}
      keys={[
        { mark: "raised", label: "Rolls and presses" },
        { mark: "flat", label: "Fixed frame and desk" },
      ]}
      caption={`Today is ${spoken(TODAY)}. You type "${WORD}" and it resolves to exactly one date, ${spoken(TARGET)}, by rule rather than by guess, so the card is stamped ${printed(TARGET)} every time.`}
    >
      <FigureStage
        kind="stamp"
        role="slider"
        aria-label="Date stamp. Use the arrow keys to step through rolling, pressing and printing."
        aria-valuemin={0}
        aria-valuemax={STOPS.length}
        aria-valuenow={stageOf(END)}
        aria-valuetext={spokenOf(END)}
      >
        <StampArt />
      </FigureStage>
    </Plate>
  );
}
