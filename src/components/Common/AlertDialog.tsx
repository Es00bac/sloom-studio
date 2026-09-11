import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Info, OctagonAlert } from 'lucide-react';
import {
  useAlertDialogStore,
  type AlertDialogRequest,
  type AlertDialogTone,
} from '../../store/alertDialogStore';
import { useI18n } from '../../lib/useI18n';

export const AlertDialog: React.FC = () => {
  const { activeRequest, respond } = useAlertDialogStore();

  if (!activeRequest) return null;

  return <AlertDialogView key={activeRequest.id} request={activeRequest} respond={respond} />;
};

interface AlertDialogViewProps {
  request: AlertDialogRequest;
  respond: () => void;
}

const toneClasses: Record<AlertDialogTone, {
  icon: React.ReactNode;
  iconClassName: string;
  borderClassName: string;
  buttonClassName: string;
}> = {
  info: {
    icon: <Info size={20} />,
    iconClassName: 'bg-cyan-500/10 text-cyan-300',
    borderClassName: 'border-cyan-500/20',
    buttonClassName: 'bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 shadow-cyan-500/10 hover:shadow-cyan-500/20',
  },
  warning: {
    icon: <AlertTriangle size={20} />,
    iconClassName: 'bg-amber-500/10 text-amber-300',
    borderClassName: 'border-amber-500/20',
    buttonClassName: 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-amber-500/10 hover:shadow-amber-500/20',
  },
  danger: {
    icon: <OctagonAlert size={20} />,
    iconClassName: 'bg-rose-500/10 text-rose-300',
    borderClassName: 'border-rose-500/20',
    buttonClassName: 'bg-gradient-to-r from-rose-600 to-rose-500 hover:from-rose-500 hover:to-rose-400 shadow-rose-500/10 hover:shadow-rose-500/20',
  },
};

export const AlertDialogView: React.FC<AlertDialogViewProps> = ({ request, respond }) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { t } = useI18n();
  const tone = request.tone ?? 'warning';
  const classes = toneClasses[tone];

  useEffect(() => {
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      respond();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [respond]);

  return (
    <div className="fixed inset-0 z-[152] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs transition-opacity duration-200">
      <section
        aria-label={request.title ?? t('dialog.alert.aria')}
        aria-modal="true"
        className={`theme-popover flex w-full max-w-md flex-col gap-5 rounded-xl border bg-[#13161f] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 ${classes.borderClassName}`}
        role="alertdialog"
      >
        <div className="flex items-start gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${classes.iconClassName}`}>
            {classes.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-100">
              {request.title ?? t('dialog.alert.title')}
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-300">
              {request.message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-800/60 pt-4">
          <button
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-lg transition-all ${classes.buttonClassName}`}
            onClick={respond}
            ref={buttonRef}
            type="button"
          >
            <Check size={14} />
            {request.confirmLabel ?? t('common.ok')}
          </button>
        </div>
      </section>
    </div>
  );
};
