import type { ClassValue } from "clsx"
import { cx } from "@/components/ui/class-names"

/** Class merging that knows the docs/07 type scale (see components/ui/class-names.ts). */
export function cn(...inputs: ClassValue[]) {
  return cx(...inputs)
}
