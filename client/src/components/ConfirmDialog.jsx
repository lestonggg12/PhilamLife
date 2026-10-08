/*
  ConfirmDialog — in-app replacement for window.confirm()

  1) Wrap your app once (e.g. in main.jsx or App.jsx):

       import { ConfirmProvider } from './components/ConfirmDialog';
       <ConfirmProvider><App /></ConfirmProvider>

  2) Use it anywhere. It returns a Promise<boolean>, so it drops in where
     window.confirm() was:

       import { useConfirm } from './components/ConfirmDialog';

       const confirm = useConfirm();

       async function handleDelete(homeowner) {
         const ok = await confirm({
           title: `Delete ${homeowner.name}?`,
           message: `${homeowner.blockLabel}, ${homeowner.lotLabel} has no payments or charges on record. This can't be undone.`,
           confirmLabel: 'Delete homeowner',
           cancelLabel: 'Keep homeowner',
           tone: 'danger',
         });
         if (!ok) return;
         // ...run the delete
       }

  No extra packages needed (icons are inline SVG).
*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './ConfirmDialog.css';

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Trash2() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function AlertTriangle() {
  return (
    <svg {...iconProps}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

const ConfirmContext = createContext(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    // If one is already open, treat the earlier one as cancelled.
    resolverRef.current?.(false);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        title: 'Are you sure?',
        message: '',
        confirmLabel: 'Confirm',
        cancelLabel: 'Cancel',
        tone: 'default',
        ...options,
      });
    });
  }, []);

  const close = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && createPortal(<ConfirmDialog {...dialog} onClose={close} />, document.body)}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, tone, onClose }) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const previouslyFocused = useRef(null);
  const isDanger = tone === 'danger';
  const Icon = isDanger ? Trash2 : AlertTriangle;

  // Focus the safe option first on destructive prompts, and restore focus on close.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    (isDanger ? cancelRef : confirmRef).current?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, [isDanger]);

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose(false);
      return;
    }
    if (event.key === 'Tab') {
      // Keep focus inside the two buttons.
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(false);
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`confirm-dialog confirm-dialog-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
      >
        <div className="confirm-icon" aria-hidden="true">
          <Icon />
        </div>
        <div className="confirm-copy">
          <h2 id={titleId}>{title}</h2>
          {message && <p id={messageId}>{message}</p>}
        </div>
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-button confirm-button-cancel"
            onClick={() => onClose(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`confirm-button ${isDanger ? 'confirm-button-danger' : 'confirm-button-primary'}`}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}