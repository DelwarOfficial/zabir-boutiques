import React, { useState } from 'react';
import { Search } from 'lucide-react';

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
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border pb-4">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input 
          type="text" 
          placeholder="Search by Order ID, Phone, Customer name..." 
          onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
          className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-4 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/50 p-1">
        {statuses.map((item) => (
          <button
            key={item.value}
            onClick={() => handleStatusChange(item.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              status === item.value 
                ? 'bg-card text-foreground shadow-xs' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
};
