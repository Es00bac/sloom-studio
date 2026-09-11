import React, { useEffect, useRef, useState } from 'react';
import { Check, PencilLine, X } from 'lucide-react';
import {
  useTextInputDialogStore,
  type TextInputDialogRequest,
} from '../../store/textInputDialogStore';
import { useI18n } from '../../lib/useI18n';

export const TextInputDialog: React.FC = () => {
  const { activeRequest, respond } = useTextInputDialogStore();

  if (!activeRequest) return null;

  return <TextInputDialogView key={activeRequest.id} request={activeRequest} respond={respond} />;
};

interface TextInputDialogViewProps {
  request: TextInputDialogRequest;
  respond: (value: string | null) => void;
}

export const TextInputDialogView: React.FC<TextInputDialogViewProps> = ({ request, respond }) => {
  const [value, setValue] = useState(request.initialValue ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const {
    title,
    message,
    label,
    placeholder,
    confirmLabel = t('common.continue'),
    cancelLabel = t('common.cancel'),
  } = request;

  const submit = () => respond(value);

  return (
    <div className="fixed inset-0 z-[151] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs transition-opacity duration-200" data-text-input-dialog="true">
      <form
        aria-label={title}
        className="theme-popover flex w-full max-w-md flex-col gap-5 rounded-xl border border-cyan-500/20 bg-[#13161f] p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
            <PencilLine size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-100">{title}</h3>
            {message ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-300">{message}</p>
            ) : null}
          </div>
        </div>

        <label className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/60">
          {label}
          <input
            ref={inputRef}
            className="rounded-lg border border-cyan-400/30 bg-[#080b10] px-3 py-2 text-sm normal-case tracking-normal text-gray-100 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-400/20"
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                respond(null);
              }
            }}
            placeholder={placeholder}
            type="text"
            value={value}
          />
        </label>

        <div className="flex items-center justify-end gap-3 border-t border-gray-800/60 pt-4">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-300 transition-all hover:bg-gray-800 hover:text-white"
            onClick={() => respond(null)}
            type="button"
          >
            <X size={14} />
            {cancelLabel}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/10 transition-all hover:from-cyan-500 hover:to-cyan-400 hover:shadow-cyan-500/20"
            type="submit"
          >
            <Check size={14} />
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};
