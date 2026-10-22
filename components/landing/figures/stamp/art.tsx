import * as React from "react";
import { Dots, FaceText, Line, Solid } from "../kit/react/draw";
import { LiveSolid } from "../shared/live-solid";
import { sceneAt, sizeOf, type CharSlot } from "./frame";
import { BLOCK_ART, CARD_ART, CARRIAGE_ART, FRAME_ART, IMPRINT, KNOB_ART, PAD_ART, SLIP_ART, THUMB_ART } from "./geometry";
import { END, TARGET, TODAY, WORD, printed, spoken } from "./model";
import { BANDS, HEIGHT, WIDTH } from "./view";

/*
 * Fig 2, server side: the date stamp after it has printed, with the card
 * slid out in front. This markup is the still; the live component rewinds
 * and replays it.
 */

export const LABEL =
  `A rotary date stamp on a desk pad. A desk calendar shows today, ${spoken(TODAY)}, and a paper slip reads "${WORD}". ` +
  `The stamp's day band has rolled from 21 to 22, and the index card in front of it is stamped ${printed(TARGET)}.`;

const [IMPRINT_DAY, IMPRINT_MONTH, IMPRINT_YEAR] = printed(TARGET).split(" ");

function Chars({ band, slots }: { band: (typeof BANDS)[number]; slots: CharSlot[] }) {
  return (
    <g data-k={`chars-${band.key}`} className="stamp-chars">
      {slots.map((slot, index) => (
        <text
          key={index}
          className="iso-face-text"
          data-tone="hi"
          fontSize={sizeOf(band.key)}
          textAnchor="middle"
          dominantBaseline="central"
          transform={slot.transform}
          opacity={slot.opacity < 1 ? slot.opacity : undefined}
        >
          {slot.text}
        </text>
      ))}
    </g>
  );
}

export function StampArt() {
  const scene = sceneAt(END);
  return (
    <svg className="iso-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={LABEL} focusable="false">
      {/* desk pad and the card track */}
      <path className="iso-halo" d={PAD_ART.halo} />
      <Solid paths={PAD_ART.slab} tone="mid" crease="faint" />
      <Line d={PAD_ART.inset} tone="faint" />
      {PAD_ART.tracks.map((paths, index) => (
        <Solid key={index} paths={paths} tone="lo" crease="none" />
      ))}

      {/* desk calendar: today */}
      <Solid paths={BLOCK_ART.body} tone="mid" crease="faint" />
      <Line d={BLOCK_ART.sheet} tone="faint" />
      <Solid paths={BLOCK_ART.binding} tone="mid" crease="faint" />
      <Dots points={BLOCK_ART.rings} size={0.6} tone="mid" />
      <FaceText transform={BLOCK_ART.weekday} size={3} anchor="middle" tone="mid">
        WED
      </FaceText>
      <FaceText transform={BLOCK_ART.day} size={7.5} anchor="middle" tone="hi">
        21
      </FaceText>
      <FaceText transform={BLOCK_ART.month} size={2.4} anchor="middle" tone="mid">
        OCT
      </FaceText>

      {/* the index card */}
      <g data-k="card" transform={scene.card}>
        <Solid paths={CARD_ART.body} tone="hi" crease="none" />
        <FaceText transform={CARD_ART.title} size={2.4} tone="hi">
          Finish Q3 report
        </FaceText>
        <FaceText transform={CARD_ART.label} size={1.5} tone="mid">
          DUE
        </FaceText>
        <Line d={CARD_ART.box} tone="lo" />
        <Line d={CARD_ART.rules} tone="faint" free />
        <g data-k="imprint" className="stamp-ink" style={scene.inked ? undefined : { opacity: 0 }}>
          {[IMPRINT_DAY, IMPRINT_MONTH, IMPRINT_YEAR].map((text, index) => (
            <FaceText key={index} transform={IMPRINT[index]!} size={sizeOf(BANDS[index]!.key)} anchor="middle" tone="hi">
              {text}
            </FaceText>
          ))}
        </g>
      </g>

      {/* frame, far plate */}
      <Solid paths={FRAME_ART.far} tone="mid" crease="faint" />

      {/* carriage: arms, axle, bands with their characters, crossbar */}
      <g data-k="carriage" transform={scene.carriage || undefined}>
        <Solid paths={CARRIAGE_ART.farArm} tone="mid" crease="faint" />
        <Solid paths={CARRIAGE_ART.farAxle} tone="mid" crease="none" />
        {BANDS.map((band, index) => (
          <React.Fragment key={band.key}>
            {index > 0 ? <Solid paths={CARRIAGE_ART.spacers[index - 1]!} tone="mid" crease="faint" /> : null}
            <Solid paths={CARRIAGE_ART.bands[index]!} tone="hi" crease="faint" />
            <Chars band={band} slots={scene.chars[index]!} />
          </React.Fragment>
        ))}
        <Solid paths={CARRIAGE_ART.nearAxle} tone="mid" crease="none" />
        <Solid paths={CARRIAGE_ART.nearArm} tone="mid" crease="faint" />
        <Solid paths={CARRIAGE_ART.cross} tone="mid" crease="faint" />
        <Dots points={CARRIAGE_ART.crossScrews} size={0.45} tone="mid" />
      </g>
      <LiveSolid name="lowerStem" paths={scene.lowerStem} tone="mid" crease="faint" />

      {/* frame, near plate with the axle slot, then the bridge */}
      <Solid paths={FRAME_ART.near} tone="mid" crease="faint" />
      <path className="stamp-slot" d={FRAME_ART.slot} />
      <Line d={FRAME_ART.slot} tone="lo" />
      <Dots points={FRAME_ART.nearScrews} size={0.5} tone="mid" />
      <Solid paths={FRAME_ART.bridge} tone="mid" crease="faint" />
      <Line d={FRAME_ART.bore} tone="lo" />
      <Dots points={FRAME_ART.bridgeScrews} size={0.5} tone="mid" />

      {/* stem and knob */}
      <LiveSolid name="upperStem" paths={scene.upperStem} tone="mid" crease="faint" />
      <g data-k="knob" transform={scene.carriage || undefined}>
        <Solid paths={KNOB_ART.collar} tone="mid" crease="faint" />
        <Solid paths={KNOB_ART.knob} tone="hi" crease="faint" inner={<Line d={KNOB_ART.knurl} tone="faint" />} />
        <Line d={KNOB_ART.cap} tone="lo" />
      </g>

      {/* thumb wheel on the axle, outside the near plate */}
      <g data-k="thumb" transform={scene.carriage || undefined}>
        <Solid paths={THUMB_ART.stub} tone="mid" crease="none" />
        <LiveSolid name="wheel" paths={THUMB_ART.wheel} tone="mid" crease="faint">
          <path data-k="thumbRibs" className="iso-line" data-tone="faint" d={scene.thumbRibs} />
        </LiveSolid>
        <Solid paths={THUMB_ART.hub} tone="mid" crease="faint" />
      </g>

      {/* the slip with the typed word */}
      <Solid paths={SLIP_ART.body} tone="hi" crease="none" />
      <FaceText transform={SLIP_ART.label} size={1.6} tone="mid">
        TYPED
      </FaceText>
      <FaceText transform={SLIP_ART.word} size={3.4} tone="hi">
        {`"${WORD}"`}
      </FaceText>
    </svg>
  );
}
