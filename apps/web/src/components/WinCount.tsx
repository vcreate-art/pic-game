/** A player's wins this session, across every game the room has played.
 *  Shows nothing until they have one. */
export function WinCount({ n = 0 }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="bingolobby__wins" title="Wins this session, across every game played in the room">
      {n} {n === 1 ? 'win' : 'wins'}
    </span>
  );
}
