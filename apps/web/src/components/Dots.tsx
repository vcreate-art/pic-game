/**
 * An ellipsis that keeps moving, for "waiting for someone" lines: the dots
 * light up one after another, so the wait reads as something happening
 * rather than something stuck. Screen readers just hear the sentence.
 */
export function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
