import { useState } from 'react';
import { useMarket } from '../store/useMarket';
import { Sheet } from './Sheet';
import { fmtClock, fmtMoney, fmtMultiplier, fmtTargetTime } from '../lib/format';
import { ArrowDown, ArrowUp } from './icons';

const LOOKAHEAD = 4;
const CHIPS = [1, 5, 25, 100];

/**
 * A combo is a parlay across consecutive rounds: every leg has to land, and
 * the multipliers compound. Future rounds have no strike yet, so they are
 * priced as a coin flip.
 */
export function ComboSheet() {
  const store = useMarket(true);
  const [stake, setStake] = useState(10);
  const [error, setError] = useState('');

  const rounds = Array.from({ length: LOOKAHEAD }, (_, i) => store.round.index + i);
  const picks = [...store.comboDraft.entries()].sort((a, b) => a[0] - b[0]);
  const multiplier = picks.reduce(
    (m, [index, side]) => m * store.comboLegMultiplier(index, side),
    1,
  );
  const canPlace = picks.length >= 2 && stake > 0 && stake <= store.balance;

  const submit = () => {
    const result = store.placeCombo(stake);
    if (!result.ok) {
      setError(result.error ?? 'Could not place');
      return;
    }
    store.closeSheet();
  };

  return (
    <Sheet
      title="Combo"
      subtitle="Chain consecutive rounds — every leg has to land"
      onClose={() => store.closeSheet()}
      footer={
        <>
          <div className="chips" style={{ marginBottom: 12 }}>
            {CHIPS.map((c) => (
              <button
                key={c}
                className={`chip tnum${stake === c ? ' active' : ''}`}
                onClick={() => {
                  setError('');
                  setStake(c);
                }}
              >
                ${c}
              </button>
            ))}
          </div>
          <button className="primary-btn" disabled={!canPlace} onClick={submit}>
            {picks.length < 2
              ? 'Pick at least two rounds'
              : `${fmtMoney(stake)} → ${fmtMoney(stake * multiplier)} (${fmtMultiplier(multiplier)})`}
          </button>
          {error && <div className="form-error">{error}</div>}
        </>
      }
    >
      {rounds.map((index, i) => {
        const endsAt = (index + 1) * store.roundMs;
        const pick = store.comboDraft.get(index);
        const isCurrent = index === store.round.index;
        const disabled = isCurrent && store.isLocked;
        return (
          <div className="combo-round" key={index}>
            <div className="cr-head">
              <div>
                <div className="cr-title">
                  {isCurrent ? 'This round' : `Round +${i}`} ·{' '}
                  {fmtTargetTime(endsAt)}
                </div>
                <div className="cr-sub tnum">
                  {isCurrent
                    ? `settles in ${fmtClock(store.msLeft)}`
                    : `opens ${fmtTargetTime(index * store.roundMs)}`}
                </div>
              </div>
              <div className="cr-sub tnum">
                {fmtMultiplier(store.comboLegMultiplier(index, pick ?? 'up'))}
              </div>
            </div>
            <div className="combo-picks">
              <button
                className={`combo-pick up${pick === 'up' ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => store.toggleComboLeg(index, 'up')}
              >
                <ArrowUp size={14} /> Up
              </button>
              <button
                className={`combo-pick down${pick === 'down' ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => store.toggleComboLeg(index, 'down')}
              >
                <ArrowDown size={14} /> Down
              </button>
            </div>
          </div>
        );
      })}

      {picks.length > 0 && (
        <button
          className="danger-btn"
          style={{ borderColor: '#2a2f37', color: 'var(--muted)' }}
          onClick={() => store.clearComboDraft()}
        >
          Clear picks
        </button>
      )}

      <div className="note">
        Future rounds have no target price yet, so each is quoted as a coin flip. One
        wrong leg ends the combo.
      </div>
    </Sheet>
  );
}
