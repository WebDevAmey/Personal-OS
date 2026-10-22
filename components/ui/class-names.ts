import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/*
 * tailwind-merge does not know the type scale tokens from docs/07 §4.2, so
 * the plain `cn` treats `text-body` like a colour and drops it when a colour
 * class such as `text-foreground` follows (or the other way round). This
 * merge knows them as font sizes. `lib/utils.ts` `cn` should adopt the same
 * config; until then, components that use the scale import this one.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["display", "display-sm", "heading-lg", "heading", "heading-sm", "body-lg", "body", "body-sm", "meta", "mono", "mono-label"],
        },
      ],
    },
  },
})

export function cx(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
