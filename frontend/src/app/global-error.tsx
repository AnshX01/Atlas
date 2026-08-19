'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', height: '100vh', width: '100%', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#121212', color: '#ffffff', padding: '1rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>A critical error occurred</h2>
          <button 
            onClick={() => reset()}
            style={{ padding: '0.5rem 1rem', backgroundColor: '#3b82f6', color: 'white', borderRadius: '0.25rem', border: 'none', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
