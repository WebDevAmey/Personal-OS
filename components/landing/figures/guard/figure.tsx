import { Plate } from "../kit/react/draw";
import { FigureStage } from "../shared/stage";
import { GuardArt } from "./art";
import "./guard.css";
import { CHANGES, COMMAND, END, readoutOf } from "./model";

export function GuardFigure() {
  return (
    <Plate
      fig="Fig 3"
      title="Guarded switch"
      hint="Point to lift · click to confirm"
      readout={readoutOf(END)}
      keys={[
        { mark: "raised", label: "Cover and switch" },
        { mark: "lit", label: "Applied" },
      ]}
      caption={`"${COMMAND}" would change ${CHANGES} tasks at once, so it waits behind a cover until you confirm. Deletes and anything sent outside the app wait the same way, and every change has Undo.`}
    >
      <FigureStage
        kind="guard"
        role="switch"
        aria-checked={false}
        aria-label={`Guarded switch: postpone ${CHANGES} tasks to Monday 26 October. Press Enter to confirm, and again to undo.`}
      >
        <GuardArt />
      </FigureStage>
    </Plate>
  );
}
