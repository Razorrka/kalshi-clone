import { useMarket } from '../store/useMarket';
import { ArrowDown, ArrowUp, Check } from './icons';

export function ResultToast() {
  const store = useMarket();
  const toast = store.toast;
  if (!toast) return null;

  return (
    <div
      className={`toast ${toast.kind}`}
      role="status"
      onClick={() => store.dismissToast()}
    >
      <div className="mark">
        {toast.kind === 'win' ? (
          <Check />
        ) : toast.kind === 'loss' ? (
          <ArrowDown size={17} />
        ) : (
          <ArrowUp size={17} />
        )}
      </div>
      <div>
        <div className="t">{toast.title}</div>
        <div className="d">{toast.detail}</div>
      </div>
    </div>
  );
}
