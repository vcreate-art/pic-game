/**
 * A cat asleep on the top edge of the join card, its tail hanging over the
 * front. It breathes, its tail sways, and z's drift off it; point at it and
 * an ear twitches. Purely for fun, so it's hidden from screen readers.
 *
 * Drawn on a 120×80 grid: y = 56 is the card's top edge, so everything above
 * sits on the card and the tail below it hangs down the card's face.
 */
export function SleepingCat() {
  return (
    <svg className="cat" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
      <path className="cat__tail" d="M103 52 C114 51 117 60 113 68 C110 74 104 75 102.5 70.5" />
      <g className="cat__breath">
        <path className="cat__fur" d="M40 56 C38 40 52 30 72 30 C94 30 106 40 106 56 Z" />
        <path className="cat__fur cat__ear cat__ear--left" d="M23 39 L25 25 L32.5 33 Z" />
        <path className="cat__fur cat__ear" d="M36 32.5 L44 26 L45.5 38.5 Z" />
        <path className="cat__inner" d="M25.6 35.5 L26.6 29 L30.2 33.2 Z" />
        <path className="cat__inner" d="M38.6 32.8 L42.6 29.8 L43.4 36.2 Z" />
        <circle className="cat__fur" cx="34" cy="44" r="12" />
        <ellipse className="cat__fur" cx="45" cy="54.6" rx="8" ry="2.6" />
        <path className="cat__eye" d="M27 45 q2.5 2.2 5 0" />
        <path className="cat__eye" d="M36 45 q2.5 2.2 5 0" />
        <circle className="cat__inner" cx="34" cy="49" r="1" />
      </g>
      <text className="cat__z" x="16" y="26">z</text>
      <text className="cat__z" x="16" y="26">z</text>
      <text className="cat__z" x="16" y="26">z</text>
    </svg>
  );
}
