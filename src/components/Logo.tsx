import React from 'react';
import { Archive, Link as LinkIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 24 }: LogoProps) {
  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      <div className="absolute inset-0 bg-indigo-600 rounded-lg rotate-3 opacity-20" />
      <div className="relative bg-indigo-600 p-1.5 rounded-lg shadow-sm shadow-indigo-200">
        <Archive size={size * 0.8} className="text-white" strokeWidth={2.5} />
        <div className="absolute -bottom-1 -right-1 bg-white p-0.5 rounded-md shadow-sm border border-slate-100">
          <LinkIcon size={size * 0.4} className="text-indigo-600" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}
