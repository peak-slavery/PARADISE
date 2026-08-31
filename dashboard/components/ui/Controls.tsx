'use client';

import { motion } from 'framer-motion';
import { useId } from 'react';

/* ---------------------------------------------------------------------------
   Neumorphic form controls.

   Every control is built from the same two primitives in `app/globals.css`:
   `.neu-inset` for anything the user types into (a channel pressed into the
   surface) and `.neu-raised` for anything they act on.
   --------------------------------------------------------------------------- */

const INPUT_BASE =
  'w-full rounded-2xl bg-base-sunken px-4 py-3 text-sm text-ink placeholder:text-ink-faint ' +
  'neu-inset-sm transition-shadow duration-200 outline-none ' +
  'focus:shadow-neu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55';

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function NeuToggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-8 w-[54px] shrink-0 rounded-full neu-track transition-opacity',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      <motion.span
        aria-hidden
        layout
        transition={{ type: 'spring', stiffness: 620, damping: 34, mass: 0.6 }}
        className={[
          'absolute top-1 h-6 w-6 rounded-full',
          checked ? 'right-1' : 'left-1',
        ].join(' ')}
        style={{
          background: checked
            ? 'linear-gradient(140deg, #6b76f5 0%, #4a56e0 100%)'
            : 'linear-gradient(140deg, #f7f9fc 0%, #dfe5ee 100%)',
          boxShadow: checked
            ? '2px 2px 6px rgba(88,101,242,0.45), -1px -1px 3px rgba(255,255,255,0.9)'
            : '2px 2px 5px rgba(148,163,189,0.55), -2px -2px 5px rgba(255,255,255,0.95)',
        }}
      />
    </button>
  );
}

export interface FieldShellProps {
  label: string;
  help?: string;
  htmlFor?: string;
  children: React.ReactNode;
  /** Renders the control to the right of a full-width label (toggle rows). */
  inline?: boolean;
}

export function FieldShell({
  label,
  help,
  htmlFor,
  children,
  inline = false,
}: FieldShellProps) {
  const labelEl = (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-semibold text-ink"
    >
      {label}
    </label>
  );

  if (inline) {
    return (
      <div className="flex items-start justify-between gap-5 rounded-2xl neu-raised-sm px-4 py-3.5">
        <div className="min-w-0">
          {labelEl}
          {help ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{help}</p> : null}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {labelEl}
      {children}
      {help ? <p className="text-xs leading-relaxed text-ink-muted">{help}</p> : null}
    </div>
  );
}

export interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

export function NeuTextInput({ value, onChange, placeholder, disabled, id }: TextInputProps) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={INPUT_BASE}
    />
  );
}

export interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  id?: string;
}

export function NeuNumberInput({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  disabled,
  id,
}: NumberInputProps) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        className={[INPUT_BASE, suffix ? 'pr-16' : ''].join(' ')}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-faint">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export interface TextareaProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  id?: string;
}

export function NeuTextarea({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled,
  id,
}: TextareaProps) {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={[INPUT_BASE, 'resize-y font-mono text-[13px] leading-relaxed'].join(' ')}
    />
  );
}

export interface SelectProps {
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  id?: string;
}

export function NeuSelect({ value, onChange, options, disabled, id }: SelectProps) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={[INPUT_BASE, 'appearance-none pr-11'].join(' ')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9.5l6 6 6-6" />
      </svg>
    </div>
  );
}

/** Segmented control used for the log-level filter. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  size?: 'sm' | 'md';
}) {
  const groupId = useId();
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 rounded-2xl neu-inset-sm p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={`${groupId}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={[
              'relative rounded-xl font-semibold transition-colors duration-200',
              size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
              active ? 'text-accent-ink' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {active ? (
              <motion.span
                layoutId={`segmented-${groupId}`}
                className="absolute inset-0 rounded-xl bg-base"
                style={{ boxShadow: 'var(--neu-shadow-sm)' }}
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
