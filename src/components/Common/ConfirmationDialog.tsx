import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useConfirmationStore } from '../../store/confirmationStore';
import { useI18n } from '../../lib/useI18n';

export const ConfirmationDialog: React.FC = () => {
  const { activeRequest, respond } = useConfirmationStore();
  const { t } = useI18n();

  if (!activeRequest) return null;

  const { title, message } = activeRequest;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs transition-opacity duration-200">
      <div className="theme-popover flex w-full max-w-md flex-col gap-5 rounded-xl border border-red-500/20 bg-[#13161f] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-100 truncate">
              {title ?? t('dialog.confirm.title')}
            </h3>
            <p className="mt-2 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap break-words">
              {message}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-800/60 pt-4">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-300 transition-all hover:bg-gray-800 hover:text-white"
            onClick={() => respond(false)}
            type="button"
          >
            <X size={14} />
            {t('common.cancel')}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/10 transition-all hover:from-cyan-500 hover:to-cyan-400 hover:shadow-cyan-500/20"
            onClick={() => respond(true)}
            type="button"
          >
            <Check size={14} />
            {t('common.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};
