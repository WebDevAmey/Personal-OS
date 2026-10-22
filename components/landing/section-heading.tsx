import * as React from "react";

export function SectionHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-mono-label text-muted-foreground uppercase">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-display-sm text-foreground text-balance">
        {title}
      </h2>
      {children ? <p className="mt-4 text-body-lg text-muted-foreground">{children}</p> : null}
    </div>
  );
}
