import React, { useState } from 'react';

interface OrderFilterPanelProps {
  onSearchChange?: (query: string) => void;
  onStatusChange?: (status: string) => void;
}

export const OrderFilterPanel: React.FC<OrderFilterPanelProps> = ({
  onSearchChange,
  onStatusChange,
}) => {
  const [status, setStatus] = useState('all');

  const statuses = [
    { value: 'all', label: 'All Orders' },
    { value: 'processing', label: 'Processing' },
    { value: 'shipping', label: 'Shipping' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const handleStatusChange = (val: string) => {
    setStatus(val);
    if (onStatusChange) onStatusChange(val);
  };

  return (
    <div className="flex flex-col gap-4 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
      <div className="relative flex-1 max-w-md">
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
        <input 
          type="text" 
          placeholder="Search by Order ID, Phone, Customer name..." 
          onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-soft p-1">
        {statuses.map((item) => (
          <button
            key={item.value}
            onClick={() => handleStatusChange(item.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              status === item.value 
                ? 'bg-surface text-ink shadow-sm' 
                : 'text-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};
