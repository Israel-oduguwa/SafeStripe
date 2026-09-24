'use client';
import { useRef, useState } from 'react';
import { SafeCheckout } from '../../../src/react/index.js';
export default function CheckoutForm({ publishableKey }: { publishableKey: string }) {
  const [token, setToken] = useState('');
  const [session, setSession] = useState<{ id: string; clientSecret: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  if (session)
    return (
      <SafeCheckout
        key={session.id}
        publishableKey={publishableKey}
        clientSecret={session.clientSecret}
      >
        <h2>Your sandbox order</h2>
        <p>Use Stripe test payment details. Your server controls the product and price.</p>
      </SafeCheckout>
    );
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setMessage('');
        try {
          const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ uiMode: 'custom' }),
          });
          const data = await response.json();
          if (!response.ok || !data.clientSecret)
            throw new Error(data.error ?? 'Cannot start checkout');
          setSession(data);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : 'Cannot start checkout');
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      <label>
        Local demo token{' '}
        <input
          type="password"
          autoComplete="off"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <button disabled={busy}>{busy ? 'Opening…' : 'Open secure checkout'}</button>
      <p role="status">{message}</p>
    </form>
  );
}
