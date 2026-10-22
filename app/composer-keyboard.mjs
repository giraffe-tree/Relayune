// Safari can report the IME's final Enter with isComposing=false and keyCode=229.
// Keep candidate selection (including command-menu navigation) inside the IME.
export function isComposerComposition(event, composing = false) {
  return composing || event.isComposing === true || event.keyCode === 229;
}
