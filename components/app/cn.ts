// components/app/cn.ts — class merging that knows the docs/07 type scale.
// Plain tailwind-merge reads `text-body` as a colour and drops it when a
// `text-foreground` follows; registering the scale keeps both.
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'display-sm', 'heading-lg', 'heading', 'heading-sm', 'body-lg', 'body', 'body-sm', 'meta', 'mono', 'mono-label'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
