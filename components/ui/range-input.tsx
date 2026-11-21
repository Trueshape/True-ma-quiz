import * as React from 'react';
import { cn } from '@/lib/utils';

type RangeInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'size'> & {
  value: number;
  min: number;
  max: number;
  size?: 'sm' | 'md' | 'lg';
};

/** A slider whose bar is filled with the theme colour up to the handle (styles in app/globals.css). */
export function RangeInput({ value, min, max, size = 'md', className, style, ...props }: RangeInputProps) {
  const fill = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      className={cn('range-input', size === 'lg' && 'range-lg', size === 'sm' && 'range-sm', className)}
      style={{ ...style, ['--fill' as string]: `${fill}%` }}
      {...props}
    />
  );
}
