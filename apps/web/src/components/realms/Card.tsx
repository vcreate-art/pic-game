import { cardDef, describeCard, type CardInstance } from '@pic-game/shared';

const KIND_LABEL: Record<string, string> = {
  primary: '',
  option: 'or',
  ally: 'ally',
  scrap: 'scrap',
};

export function Card({
  card,
  onClick,
  onOption,
  onScrap,
  disabled,
  dim,
  footer,
}: {
  card: CardInstance;
  onClick?: () => void;
  /** Present when the card offers a choice its owner can take now. */
  onOption?: (index: number) => void;
  onScrap?: () => void;
  disabled?: boolean;
  dim?: boolean;
  footer?: string;
}) {
  const d = cardDef(card.key);
  const lines = describeCard(d);
  let optionIndex = -1;

  return (
    <div className={`rcard rcard--${d.faction} ${dim ? 'is-dim' : ''}`}>
      <button
        type="button"
        className="rcard__face"
        onClick={onClick}
        disabled={disabled || !onClick}
        title={onClick ? d.name : undefined}
      >
        <span className="rcard__head">
          <span className="rcard__name">{d.name}</span>
          {d.cost > 0 && <span className="rcard__cost">{d.cost}</span>}
        </span>
        <span className="rcard__type">
          {d.type === 'outpost' ? `Outpost ${d.defense}` : d.type === 'base' ? `Base ${d.defense}` : 'Ship'}
        </span>
        <span className="rcard__lines">
          {lines.map((l, i) => (
            <span key={i} className={`rline rline--${l.kind}`}>
              {KIND_LABEL[l.kind] && <em>{KIND_LABEL[l.kind]}</em>}
              {l.text}
            </span>
          ))}
        </span>
      </button>

      {(onOption || onScrap) && (
        <div className="rcard__acts">
          {onOption &&
            (d.options ?? []).map((o, i) => {
              optionIndex = i;
              return (
                <button key={i} type="button" className="tool" onClick={() => onOption(i)}>
                  {describeCard({ ...d, primary: o, options: undefined, ally: undefined, scrap: undefined })[0]?.text ?? 'Use'}
                </button>
              );
            })}
          {onOption && !d.options && d.primary && (
            <button type="button" className="tool" onClick={() => onOption(0)}>
              Use
            </button>
          )}
          {onScrap && (
            <button type="button" className="tool tool--danger" onClick={onScrap}>
              Scrap
            </button>
          )}
        </div>
      )}
      {footer && <span className="rcard__footer">{footer}</span>}
    </div>
  );
}

/** A face-down stack, for decks and anything else that is only a count. */
export function CardStack({ label, count }: { label: string; count: number }) {
  return (
    <div className="rstack">
      <span className="rstack__count">{count}</span>
      <span className="rstack__label">{label}</span>
    </div>
  );
}
