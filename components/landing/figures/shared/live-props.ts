import type * as React from "react";

/* Every live module is a client component that renders nothing: it attaches
   to the stage and the server-rendered SVG inside it, and animates them. */
export interface LiveProps {
  root: React.RefObject<HTMLDivElement | null>;
}
