import * as React from "react";
import { Dots, FaceText, Line, Solid } from "../kit/react/draw";
import { LiveSolid } from "../shared/live-solid";
import { sceneAt, type Scene } from "./frame";
import { BEZEL_ART, HINGE_ART, LAMP_ART, NUT_ART, PANEL_ART, PLATE_ART, UNDO_ART } from "./geometry";
import { CHANGES, CLASSES, END, classesOf, ACTION } from "./model";
import { HEIGHT, WIDTH } from "./view";

/*
 * Fig 3, server side: the guarded switch at rest, cover down, nothing
 * applied. This markup is the still; the live component lifts the cover,
 * flips the switch and puts it all back.
 */

export const LABEL =
  `A guarded toggle switch on a small panel. A hinged cover sits over the switch. A plate reads "Postpone ${CHANGES} tasks to Mon 26 Oct" ` +
  "and marks it BULK. To apply it you lift the cover and flip the switch; a lamp then lights, and an Undo button sits beside it.";

const ACTIVE = new Set(classesOf(ACTION));

function Cover({ name, scene, show }: { name: string; scene: Scene; show: boolean }) {
  return (
    <g data-k={name} style={show ? undefined : { display: "none" }}>
      <LiveSolid name={`${name}Body`} paths={scene.cover} tone="hi" crease="faint" />
      <path data-k={`${name}Cavity`} className="guard-cavity" d={scene.cavity} />
    </g>
  );
}

const hidden = { display: "none" } as const;

export function GuardArt() {
  const scene = sceneAt(END);
  return (
    <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false">
      <defs>
        <clipPath id="guard-clip">
          <path data-k="clip" clipRule="evenodd" d={scene.clip} />
        </clipPath>
        <g id="guard-bat">
          <Solid paths={NUT_ART.nut} tone="mid" crease="faint" />
          <Solid paths={NUT_ART.ball} tone="mid" crease="none" />
          <LiveSolid name="shaft" paths={scene.shaft} tone="hi" crease="faint" />
          <LiveSolid name="tip" paths={scene.tip} tone="hi" crease="faint" />
        </g>
      </defs>

      {/* panel */}
      <path className="iso-halo" d={PANEL_ART.halo} />
      {PANEL_ART.feet.map((paths, index) => (
        <Solid key={index} paths={paths} tone="lo" crease="none" />
      ))}
      <Solid paths={PANEL_ART.body} tone="mid" crease="faint" />
      <Line d={PANEL_ART.inset} tone="faint" />
      <Dots points={PANEL_ART.screws} size={0.5} tone="mid" />

      {/* lamp and undo */}
      <Solid paths={LAMP_ART.ring} tone="mid" crease="faint" />
      <g data-k="lamp" className="guard-lamp" data-on={scene.lit ? "" : undefined}>
        <Solid paths={LAMP_ART.lens} tone="hi" crease="faint" lit={scene.lit} />
      </g>
      <FaceText transform={LAMP_ART.label} size={1.8} anchor="middle" tone="mid">
        APPLIED
      </FaceText>
      <Solid paths={UNDO_ART.base} tone="mid" crease="faint" />
      <Solid paths={UNDO_ART.cap} tone="mid" crease="faint" />
      <FaceText transform={UNDO_ART.label} size={1.8} anchor="middle" tone="mid">
        UNDO
      </FaceText>

      {/* the command plate */}
      <Solid paths={PLATE_ART.body} tone="hi" crease="none" />
      <FaceText transform={PLATE_ART.line1} size={2.2} tone="hi">
        {`POSTPONE ${CHANGES} TASKS`}
      </FaceText>
      <FaceText transform={PLATE_ART.line2} size={2.2} tone="mid">
        → MON 26 OCT
      </FaceText>
      {CLASSES.map((name, index) => (
        <FaceText key={name} transform={PLATE_ART.classes[index]!} size={1.7} tone={ACTIVE.has(name) ? "hi" : "lo"}>
          {name}
        </FaceText>
      ))}
      {CLASSES.map((name, index) => (
        <Dots key={name} points={[PLATE_ART.marks[index]!]} size={ACTIVE.has(name) ? 0.7 : 0.4} tone={ACTIVE.has(name) ? "hi" : "lo"} />
      ))}

      {/* bezel */}
      <Solid paths={BEZEL_ART.plate} tone="mid" crease="faint" />
      <Dots points={BEZEL_ART.screws} size={0.45} tone="mid" />
      <FaceText transform={BEZEL_ART.label} size={1.8} anchor="middle" tone="mid">
        CONFIRM
      </FaceText>

      {/* cover, when it has swung behind its hinge */}
      <Cover name="coverBack" scene={scene} show={scene.coverSlot === "back"} />

      {/* hinge */}
      {HINGE_ART.blocks.map((paths, index) => (
        <Solid key={index} paths={paths} tone="mid" crease="faint" />
      ))}
      <Solid paths={HINGE_ART.barrel} tone="mid" crease="faint" />

      {/* the bat, when the cover is out of its way */}
      <use data-k="batPlain" href="#guard-bat" style={scene.batSlot === "plain" ? undefined : hidden} />

      {/* cover, in front of its hinge; the bat shows through its open bottom */}
      <Cover name="coverFront" scene={scene} show={scene.coverSlot === "front"} />
      <use data-k="batClipped" href="#guard-bat" clipPath="url(#guard-clip)" style={scene.batSlot === "clipped" ? undefined : hidden} />
    </svg>
  );
}
