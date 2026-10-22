import * as React from "react";
import { Dots, Line, Solid } from "../kit/react/draw";
import { LiveSolid } from "../shared/live-solid";
import { BASE_ART, BIN_ART, CARD_ART, CARD_KINDS, CONVEYOR_ART, GATE_ART, HOPPER_ART, SHELF_ART, TIMER_ART } from "./geometry";
import { POOL, sceneAt, type CardSlot } from "./frame";
import { END } from "./model";
import { HEIGHT, WIDTH } from "./view";

/*
 * Fig 1, server side: the whole desk in painter's order, posed at the end of
 * the morning sort. This markup is the still (no JavaScript, reduced motion,
 * first paint); the live component animates these same nodes.
 */

export const LABEL =
  "A sorting desk. An intake tray holds 43 cards: emails, tasks and calendar events. A belt carries them one by one past a paddle gate. " +
  "The gate swings out for the six that need you today and pushes them through an outlet onto a shelf with seven seats; every other card runs " +
  "off the end of the belt into a deep bin for later.";

function CardTemplates() {
  return (
    <defs>
      {CARD_KINDS.map((kind) =>
        (["plain", "need", "lit"] as const).map((variant) => {
          const marks = CARD_ART[kind];
          const id = `sorter-${kind}${variant === "plain" ? "" : `-${variant}`}`;
          return (
            <g key={id} id={id}>
              <Solid paths={CARD_ART.body} tone={variant === "plain" ? "mid" : "hi"} crease="none" lit={variant === "lit"}>
                <Line d={marks.lines} tone={variant === "plain" ? "lo" : "mid"} />
                <Line d={marks.stamp} tone={variant === "plain" ? "lo" : "mid"} />
                <Line d={marks.text} tone="faint" free />
              </Solid>
            </g>
          );
        }),
      )}
    </defs>
  );
}

function Slots({ name, slots }: { name: string; slots: (CardSlot | null)[] }) {
  return (
    <g data-k={name}>
      {slots.map((slot, index) => (
        <use
          key={index}
          href={slot?.href ?? "#sorter-mail"}
          transform={slot?.transform}
          opacity={slot?.opacity || undefined}
          style={slot ? undefined : { display: "none" }}
        />
      ))}
    </g>
  );
}

export function SorterArt() {
  const scene = sceneAt(END);
  return (
    <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false">
      <CardTemplates />

      {/* base */}
      <path className="iso-halo" d={BASE_ART.halo} />
      {BASE_ART.feet.map((parts, index) => (
        <g key={index}>
          <Solid paths={parts[0]!} tone="lo" crease="faint" />
          <Solid paths={parts[1]!} tone="mid" crease="faint" />
        </g>
      ))}
      <Solid paths={BASE_ART.slab} tone="mid" crease="faint" />
      <Line d={BASE_ART.groove} tone="faint" />
      <Line d={BASE_ART.screwRings} tone="lo" />
      <Dots points={BASE_ART.screws} size={0.5} tone="mid" />
      <Solid paths={BASE_ART.label} tone="lo" crease="none" />
      <Line d={BASE_ART.labelLine} tone="faint" />
      <Line d={BASE_ART.labelRule} tone="lo" free />
      <Dots points={BASE_ART.labelScrews} size={0.45} tone="mid" />
      <path className="iso-halo sorter-soft" d={BIN_ART.halo} />

      {/* conveyor, far side */}
      {CONVEYOR_ART.farLegs.map((leg, index) => (
        <g key={index}>
          <Solid paths={leg.foot} tone="lo" crease="faint" />
          <Solid paths={leg.leg} tone="mid" crease="faint" />
          <Dots points={leg.screws} size={0.4} tone="mid" />
        </g>
      ))}
      <Solid paths={GATE_ART.actuatorFoot} tone="lo" crease="faint" />
      <Solid paths={GATE_ART.actuator} tone="mid" crease="faint" inner={<Line d={GATE_ART.actuatorSeam} tone="faint" />} />
      <Line d={GATE_ART.actuatorVents} tone="lo" />
      <Dots points={GATE_ART.actuatorScrews} size={0.4} tone="mid" />
      <Solid paths={CONVEYOR_ART.farRail} tone="mid" crease="faint" />
      <Dots points={CONVEYOR_ART.farRailScrews} size={0.45} tone="mid" />
      <Solid paths={CONVEYOR_ART.rollers[0]!} tone="mid" crease="faint" />
      <Solid paths={CONVEYOR_ART.belt} tone="lo" crease="faint" />
      <Solid paths={CONVEYOR_ART.rollers[1]!} tone="mid" crease="faint" />
      <path data-k="slats" className="iso-line" data-tone="faint" d={scene.slats} />

      {/* hopper, far walls */}
      <Solid paths={HOPPER_ART.back} tone="mid" crease="faint" />
      <Solid paths={HOPPER_ART.farSide} tone="mid" crease="faint" />
      <Solid paths={HOPPER_ART.farBracket} tone="mid" crease="faint" />

      {/* the gate */}
      <LiveSolid name="paddle" paths={scene.paddle} tone="hi" crease="faint" />
      <Solid paths={GATE_ART.pin} tone="mid" crease="none" />
      <Solid paths={GATE_ART.bracket} tone="mid" crease="faint" />
      <Solid paths={GATE_ART.arm} tone="mid" crease="faint" />
      <Dots points={GATE_ART.armScrews} size={0.4} tone="mid" />
      <Solid paths={GATE_ART.cap} tone="mid" crease="faint" />
      <Line d={GATE_ART.capKnurl} tone="lo" />
      <Line d={GATE_ART.capRing} tone="lo" />

      {/* cards riding the belt */}
      <Slots name="belt" slots={scene.cards.belt} />

      {/* hopper: the stack, then the near and front walls */}
      <LiveSolid name="stack" paths={scene.stack.paths} tone="hi" crease="lo">
        <path data-k="stackSeams" className="iso-line" data-tone="faint" d={scene.stack.seams} />
      </LiveSolid>
      <Solid paths={HOPPER_ART.nearSide} tone="mid" crease="faint" inner={<Line d={HOPPER_ART.nearSeam} tone="faint" />} />
      <Dots points={HOPPER_ART.nearRivets} size={0.4} tone="mid" />
      <Solid paths={HOPPER_ART.front} tone="mid" crease="faint" inner={<Line d={HOPPER_ART.frontSeam} tone="faint" />} />
      <Dots points={HOPPER_ART.frontRivets} size={0.4} tone="mid" />
      <Line d={HOPPER_ART.throatLip} tone="lo" />

      {/* conveyor, near side */}
      {CONVEYOR_ART.nearLegs.map((leg, index) => (
        <g key={index}>
          <Solid paths={leg.foot} tone="lo" crease="faint" />
          <Solid paths={leg.leg} tone="mid" crease="faint" />
          <Dots points={leg.screws} size={0.4} tone="mid" />
        </g>
      ))}
      <Solid paths={CONVEYOR_ART.nearLeft} tone="mid" crease="faint" inner={<Line d={CONVEYOR_ART.nearLeftSeam} tone="faint" />} />
      <Solid paths={CONVEYOR_ART.nearRight} tone="mid" crease="faint" inner={<Line d={CONVEYOR_ART.nearRightSeam} tone="faint" />} />
      <Dots points={CONVEYOR_ART.nearScrews} size={0.45} tone="mid" />
      {CONVEYOR_ART.axles.map((axle, index) => (
        <g key={index}>
          <Line d={axle.ring} tone="lo" />
          <Dots points={[axle.hub]} size={0.6} tone="mid" />
        </g>
      ))}
      <Solid paths={HOPPER_ART.nearBracket} tone="mid" crease="faint" />

      {/* the Today shelf with the transfer plate */}
      <Solid paths={SHELF_ART.plinth} tone="mid" crease="faint" inner={<Line d={SHELF_ART.plinthSeam} tone="faint" />} />
      <Line d={SHELF_ART.seatLines} tone="faint" />
      <Solid paths={SHELF_ART.backLip} tone="mid" crease="faint" />
      <Solid paths={SHELF_ART.stop} tone="mid" crease="faint" />
      <Dots points={SHELF_ART.stopScrews} size={0.4} tone="mid" />
      {SHELF_ART.platePosts.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" crease="none" />
      ))}
      <Solid paths={SHELF_ART.plate} tone="mid" crease="faint" />
      <Dots points={SHELF_ART.plateScrews} size={0.45} tone="mid" />
      <Slots name="out" slots={scene.cards.out} />
      <Solid paths={SHELF_ART.frontLip} tone="mid" crease="faint" />
      <Line d={SHELF_ART.seats.minor} tone="lo" />
      <Line d={SHELF_ART.seats.major} tone="mid" />

      {/* the Later bin */}
      <Solid paths={BIN_ART.floor} tone="lo" crease="none" />
      <Solid paths={BIN_ART.back} tone="mid" crease="faint" />
      <Dots points={BIN_ART.backRivets} size={0.4} tone="mid" />
      <Solid paths={BIN_ART.far} tone="mid" crease="faint" />
      <Dots points={BIN_ART.farRivets} size={0.4} tone="mid" />
      <LiveSolid name="pile" paths={scene.pile.paths} tone="mid" crease="faint">
        <path data-k="pileSeams" className="iso-line" data-tone="faint" d={scene.pile.seams} />
      </LiveSolid>
      <Slots name="bin" slots={scene.cards.bin} />
      <Solid paths={BIN_ART.front} tone="mid" crease="faint" inner={<Line d={BIN_ART.frontSeam} tone="faint" />} />
      <Solid paths={BIN_ART.right} tone="mid" crease="faint" inner={<Line d={BIN_ART.rightSeam} tone="faint" />} />
      <Dots points={BIN_ART.rivets} size={0.45} tone="mid" />

      {/* the timer, set to the briefing hour */}
      <path className="iso-halo sorter-soft" d={TIMER_ART.halo} />
      <Solid paths={TIMER_ART.foot} tone="lo" crease="faint" />
      <Dots points={TIMER_ART.footScrews} size={0.45} tone="mid" />
      <Solid paths={TIMER_ART.crownCap} tone="mid" crease="faint" />
      <Solid paths={TIMER_ART.crown} tone="mid" crease="faint" />
      <Solid paths={TIMER_ART.puck} tone="mid" crease="faint" inner={<Line d={TIMER_ART.band} tone="faint" />} />
      <Line d={TIMER_ART.knurl} tone="faint" />
      <Line d={TIMER_ART.bezel} tone="lo" />
      <Line d={TIMER_ART.face} tone="faint" />
      <Line d={TIMER_ART.minor} tone="lo" />
      <Line d={TIMER_ART.major} tone="mid" />
      <path className="iso-line sorter-hand" data-tone="hi" d={TIMER_ART.hour} />
      <path className="iso-line sorter-hand" data-tone="hi" d={TIMER_ART.minute} />
      <Line d={TIMER_ART.hub} tone="hi" />
    </svg>
  );
}

export { POOL };
