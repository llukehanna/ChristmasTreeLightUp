/** Leaving the page now would lose something: unsaved edits, queued or running uploads, or a save still in flight. */
export function mustWarnBeforeLeaving(s: { dirty: boolean; busy: boolean; saving: boolean }): boolean {
  return s.dirty || s.busy || s.saving;
}
