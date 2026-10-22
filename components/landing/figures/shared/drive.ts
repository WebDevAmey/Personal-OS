/*
 * The clock behind every live figure. A figure is a pure function of time
 * t in [0, end]; this file only decides what t is.
 *
 * - It starts at `end`, which is what the server rendered, so attaching is
 *   invisible.
 * - Idle tour: 1.4 s after attaching (and 3.6 s after the last input) it
 *   fades the moving parts out, rewinds to 0, fades back in and plays to the
 *   end at real speed, holds, and loops.
 * - Pointer: x across the stage picks a target time; t follows it with an
 *   exponential ease (tau 0.25 s).
 * - Keys: arrows step between the figure's stops; Home and End jump.
 * - It stops drawing while the stage is offscreen or the tab is hidden.
 * - Under reduced motion there is no tour and every input jumps straight to
 *   its target.
 */

export interface Driver {
  end: number;
  stops: number[];
  render: (t: number) => void;
  /* Seconds to hold the finished state before the tour loops. */
  hold?: number;
  /* false: the pointer does not scrub; the figure wires its own input. */
  scrub?: boolean;
  /* Extra input for the figure, given a handle on the clock. */
  attach?: (control: Control) => () => void;
}

export interface Control {
  /* ease toward a time (instant under reduced motion) */
  input: (t: number) => void;
  /* jump to a time that looks the same as the current one */
  jump: (t: number) => void;
  /* where the clock is heading */
  target: () => number;
}

const TOUR_AFTER = 1.4;
const RESUME_AFTER = 3.6;
const TAU = 0.25;
const FADE_MS = 280;
const STILL = "(prefers-reduced-motion: reduce)";

export function drive(stage: HTMLDivElement, driver: Driver): () => void {
  const { end, stops, render } = driver;
  const hold = driver.hold ?? 4;
  const svg = stage.querySelector<SVGSVGElement>("svg");
  const still = window.matchMedia(STILL);

  let t = end;
  let target = end;
  let mode: "idle" | "tour" | "scrub" = "idle";
  let quietFor = RESUME_AFTER - TOUR_AFTER;
  let heldFor = hold;
  let visible = true;
  let fading = false;
  let frame = 0;
  let last = 0;

  const draw = () => render(t);

  const fadeTo = (opacity: string) => {
    if (svg) svg.style.opacity = opacity;
  };
  if (svg) svg.style.transition = `opacity ${FADE_MS}ms cubic-bezier(0.215, 0.61, 0.355, 1)`;

  const rewind = () => {
    fading = true;
    fadeTo("0");
    window.setTimeout(() => {
      t = 0;
      target = 0;
      draw();
      fadeTo("");
      fading = false;
      mode = "tour";
    }, FADE_MS);
  };

  const step = (now: number) => {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (!fading) {
      if (mode === "scrub") {
        quietFor += dt;
        const gap = target - t;
        t = Math.abs(gap) < 0.002 ? target : t + gap * (1 - Math.exp(-dt / TAU));
        if (quietFor >= RESUME_AFTER && t === target) mode = t >= end ? "idle" : "tour";
        if (mode === "idle") heldFor = hold;
      } else if (mode === "tour") {
        t = Math.min(end, t + dt);
        target = t;
        if (t >= end) {
          mode = "idle";
          heldFor = 0;
        }
      } else {
        quietFor += dt;
        heldFor += dt;
        if (!still.matches && quietFor >= RESUME_AFTER && heldFor >= hold) rewind();
      }
      draw();
    }
    schedule();
  };

  const schedule = () => {
    if (frame || !visible || document.hidden || still.matches) return;
    frame = requestAnimationFrame(step);
  };

  const halt = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };

  /* Reduced motion: no loop, inputs land at once. */
  const input = (next: number) => {
    target = Math.min(end, Math.max(0, next));
    quietFor = 0;
    if (still.matches) {
      t = target;
      draw();
      return;
    }
    mode = "scrub";
    schedule();
  };

  const jump = (next: number) => {
    t = target = next;
    draw();
  };
  const detach = driver.attach?.({ input, jump, target: () => (mode === "scrub" ? target : t) });

  const onPointer = (event: PointerEvent) => {
    if (driver.scrub === false) return;
    if (event.pointerType === "touch" && event.type === "pointermove" && !event.buttons) return;
    const box = stage.getBoundingClientRect();
    if (!box.width) return;
    const x = (event.clientX - box.left) / box.width;
    input(Math.min(1, Math.max(0, (x - 0.08) / 0.84)) * end);
  };

  const onKey = (event: KeyboardEvent) => {
    const from = mode === "scrub" ? target : t;
    let next: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = stops.find((stop) => stop > from + 1e-3) ?? end;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = [...stops].reverse().find((stop) => stop < from - 1e-3) ?? 0;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = end;
    if (next === undefined) return;
    event.preventDefault();
    input(next);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      visible = entries.at(-1)?.isIntersecting ?? true;
      if (visible) schedule();
      else halt();
    },
    { rootMargin: "120px 0px" },
  );
  observer.observe(stage);

  const onVisibility = () => (document.hidden ? halt() : schedule());
  const onStill = () => {
    if (still.matches) {
      halt();
      mode = "idle";
      t = target = end;
      fadeTo("");
      draw();
    } else schedule();
  };

  stage.addEventListener("pointermove", onPointer);
  stage.addEventListener("pointerdown", onPointer);
  stage.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  still.addEventListener("change", onStill);
  schedule();

  return () => {
    detach?.();
    halt();
    observer.disconnect();
    stage.removeEventListener("pointermove", onPointer);
    stage.removeEventListener("pointerdown", onPointer);
    stage.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisibility);
    still.removeEventListener("change", onStill);
    fadeTo("");
  };
}

/* Writes the plate's readout and the stage's slider values, only on change. */
export function announcer(stage: HTMLDivElement) {
  const readout = stage.closest(".iso-plate")?.querySelector<HTMLElement>("[data-readout]") ?? null;
  let lastText = readout?.textContent ?? "";
  let lastNow = stage.getAttribute("aria-valuenow") ?? "";
  return (text: string, now?: number, spoken?: () => string) => {
    if (readout && text !== lastText) {
      readout.textContent = text;
      lastText = text;
    }
    if (now !== undefined && `${now}` !== lastNow) {
      lastNow = `${now}`;
      stage.setAttribute("aria-valuenow", lastNow);
      if (spoken) stage.setAttribute("aria-valuetext", spoken());
    }
  };
}
