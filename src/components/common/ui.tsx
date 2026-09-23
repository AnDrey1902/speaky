import React from 'react';

/* ── Button ─────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-500 hover:bg-indigo-400 text-white shadow-[0_0_18px_-6px_rgba(99,102,241,0.7)]',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/70',
  ghost: 'bg-transparent hover:bg-zinc-800/70 text-zinc-400 hover:text-zinc-100',
  danger: 'bg-transparent hover:bg-rose-500/10 text-rose-400 border border-rose-500/30',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
};

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
> = ({ variant = 'secondary', className = '', ...props }) => (
  <button
    {...props}
    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
  />
);

/* ── Card / SettingRow ──────────────────────────────────────────────── */

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <div
    {...props}
    className={`rounded-xl border border-zinc-800 bg-zinc-900/70 shadow-xs ${className}`}
  >
    {children}
  </div>
);

export const SettingRow: React.FC<{
  icon?: React.ElementType;
  title: React.ReactNode;
  desc?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}> = ({ icon: Icon, title, desc, children, className = '' }) => (
  <div
    className={`p-4 rounded-xl border border-zinc-800 bg-zinc-900/70 flex items-center justify-between gap-4 hover:border-zinc-700 transition-colors ${className}`}
  >
    <div className="flex items-center gap-3.5 min-w-0">
      {Icon && (
        <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 shrink-0">
          <Icon className="w-4 h-4" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-100">{title}</div>
        {desc && <div className="text-[11px] text-zinc-500 leading-relaxed">{desc}</div>}
      </div>
    </div>
    {children && <div className="shrink-0">{children}</div>}
  </div>
);

/* ── Switch ─────────────────────────────────────────────────────────── */

export const Switch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex items-center cursor-pointer" title={label}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="sr-only peer"
    />
    <div className="w-10 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer transition-colors peer-checked:bg-indigo-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
  </label>
);

/* ── Select ─────────────────────────────────────────────────────────── */

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <select
    {...props}
    className={`px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer ${className}`}
  >
    {children}
  </select>
);

/* ── Input / Textarea ───────────────────────────────────────────────── */

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
  className = '',
  ...props
}) => (
  <input
    {...props}
    className={`w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors ${className}`}
  />
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({
  className = '',
  ...props
}) => (
  <textarea
    {...props}
    className={`w-full px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/80 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors ${className}`}
  />
);

/* ── Badge ──────────────────────────────────────────────────────────── */

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  accent: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  danger: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
};

export const Badge: React.FC<{ tone?: BadgeTone; className?: string; children: React.ReactNode }> = ({
  tone = 'neutral',
  className = '',
  children,
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${badgeTones[tone]} ${className}`}
  >
    {children}
  </span>
);

/* ── ProgressBar ────────────────────────────────────────────────────── */

export const ProgressBar: React.FC<{ value: number; indeterminate?: boolean }> = ({
  value,
  indeterminate,
}) => (
  <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
    {indeterminate ? (
      <div className="h-1.5 rounded-full bg-indigo-500 animate-pulse w-1/3" />
    ) : (
      <div
        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    )}
  </div>
);

/* ── EmptyState ─────────────────────────────────────────────────────── */

export const EmptyState: React.FC<{ icon?: React.ElementType; children: React.ReactNode }> = ({
  icon: Icon,
  children,
}) => (
  <div className="p-8 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 text-center">
    {Icon && <Icon className="w-5 h-5 mx-auto mb-2 text-zinc-600" />}
    <div className="text-xs text-zinc-500">{children}</div>
  </div>
);

/* ── Section heading used at the top of every tab ───────────────────── */

export const TabHeader: React.FC<{ title: string; subtitle?: string; right?: React.ReactNode }> = ({
  title,
  subtitle,
  right,
}) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <h3 className="text-lg font-semibold text-zinc-50 tracking-tight mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-zinc-500 leading-relaxed">{subtitle}</p>}
    </div>
    {right}
  </div>
);
