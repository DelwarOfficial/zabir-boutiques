import React from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  description: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  icon?: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  description,
  trend,
  icon,
}) => {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h3 className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {value}
          </h3>
        </div>
        {icon && (
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            {icon}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {trend && (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
            trend.isPositive 
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' 
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
          }`}>
            {trend.isPositive ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0v-8m0 8l-8-8-4 4-6-6"/></svg>
            )}
            {trend.isPositive ? '+' : ''}{trend.value}%
          </span>
        )}
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </div>
  );
};
