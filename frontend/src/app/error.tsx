'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-[var(--bg-primary)] p-4 text-[var(--text-primary)]">
      <div className="flex max-w-md flex-col items-center space-y-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <h2 className="text-2xl font-bold">Something went wrong!</h2>
        <p className="text-[var(--text-secondary)] text-sm">
          An unexpected error occurred. Our team has been notified. You can try recovering by clicking below.
        </p>
        <div className="flex space-x-4">
          <Button onClick={() => reset()} variant="primary">
            Try again
          </Button>
          <Button onClick={() => window.location.reload()} variant="secondary">
            Reload page
          </Button>
        </div>
      </div>
    </div>
  );
}
