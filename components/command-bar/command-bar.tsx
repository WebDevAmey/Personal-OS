// components/command-bar/command-bar.tsx — retired. The command palette now
// lives inside the signed-in app shell (components/command/palette.tsx), so
// public pages render no command UI. Kept only so a root layout that still
// imports it renders nothing; remove the import and this file together.
export function CommandBar() {
  return null;
}
