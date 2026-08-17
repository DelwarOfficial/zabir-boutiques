import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  isLoading
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-muted">{message}</p>
        
        <div className="mt-6 flex justify-end gap-3">
          <button 
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-surface-soft"
          >
            Cancel
          </button>
          <button 
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            {isLoading ? 'Processing...' : 'Confirm action'}
          </button>
        </div>
      </div>
    </div>
  );
};
