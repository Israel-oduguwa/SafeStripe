'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { loadStripe, type Appearance, type StripeCheckoutSession } from '@stripe/stripe-js';
import {
  CheckoutElementsProvider,
  PaymentElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';

export type CheckoutLoadState = 'loading' | 'ready' | 'slow' | 'error';

export interface SafeCheckoutProps {
  /** Publishable key only. Secret keys must stay on your server. */
  publishableKey: string;
  /** A custom Checkout Session secret returned by your authenticated server. */
  clientSecret: string;
  children?: ReactNode;
  appearance?: Appearance;
  className?: string;
  style?: CSSProperties;
  buttonLabel?: string;
  /** Field readiness only. Never use this notification as proof of payment. */
  onLoadStateChange?: (state: CheckoutLoadState) => void;
  /** Display-only notification. Fulfill the order through a verified server webhook. */
  onComplete?: (session: StripeCheckoutSession) => void;
}
const card: CSSProperties = {
  maxWidth: 480,
  margin: '0 auto',
  padding: 28,
  border: '1px solid #dbe2ed',
  borderRadius: 20,
  background: '#fff',
  color: '#162034',
  boxShadow: '0 12px 40px #1620340d',
  fontFamily: 'system-ui, sans-serif',
};
const button: CSSProperties = {
  width: '100%',
  marginTop: 24,
  padding: '14px 20px',
  borderRadius: 10,
  border: 0,
  background: '#635bff',
  color: '#fff',
  font: '600 16px system-ui',
};
function PaymentForm(props: SafeCheckoutProps & { retry: () => void }) {
  const state = useCheckoutElements();
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fieldError, setFieldError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState('');
  const submitting = useRef(false);
  const loadState: CheckoutLoadState =
    state.type === 'error' || fieldError ? 'error' : ready ? 'ready' : slow ? 'slow' : 'loading';
  const observer = useRef(props.onLoadStateChange);
  observer.current = props.onLoadStateChange;
  useEffect(() => {
    try {
      observer.current?.(loadState);
    } catch {
      /* Display callbacks must not interrupt Stripe initialization. */
    }
  }, [loadState]);
  useEffect(() => {
    if (ready || state.type === 'error' || fieldError) return;
    const timeout = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(timeout);
  }, [ready, state.type, fieldError]);
  const recovery = (
    <div>
      <p role="alert">
        {loadState === 'error'
          ? 'Unable to load the secure payment form.'
          : 'Stripe is taking longer than expected to load.'}{' '}
        Check your connection and allow Stripe in your browser, then retry. If this continues,
        contact support.
      </p>
      <button type="button" onClick={props.retry} style={button}>
        Retry payment form
      </button>
      <p style={{ fontSize: 12 }}>Retry reloads this checkout. It does not create a new payment.</p>
    </div>
  );
  if (state.type === 'loading')
    return slow ? recovery : <p role="status">Loading secure payment form…</p>;
  if (state.type === 'error') return recovery;
  return (
    <form
      aria-label="Secure payment"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || complete || !ready || fieldError) return;
        submitting.current = true;
        setBusy(true);
        setMessage('');
        try {
          const result = await state.checkout.confirm({ redirect: 'if_required' });
          if (result.type === 'error') setMessage(result.error.message);
          else {
            setComplete(true);
            setMessage('Payment submitted. We are confirming your order.');
            try {
              props.onComplete?.(result.session);
            } catch {
              /* Consumer UI callbacks must not change the confirmed payment state. */
            }
          }
        } catch {
          setMessage(
            'We could not confirm the result. Check your order status before trying again.',
          );
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <PaymentElement
        options={{ layout: 'accordion' }}
        onReady={() => {
          setReady(true);
          setFieldError(false);
        }}
        onLoadError={() => {
          setReady(false);
          setFieldError(true);
        }}
      />
      {!ready &&
        !busy &&
        !complete &&
        (slow || fieldError ? recovery : <p role="status">Loading secure payment form…</p>)}
      <button
        type="submit"
        disabled={busy || complete || !ready || fieldError}
        style={{
          ...button,
          opacity: busy || complete || !ready || fieldError ? 0.65 : 1,
          cursor: busy || complete || !ready || fieldError ? 'default' : 'pointer',
        }}
      >
        {complete ? 'Submitted' : busy ? 'Processing…' : (props.buttonLabel ?? 'Pay securely')}
      </button>
      <p role="status" aria-live="polite" style={{ fontSize: 14, lineHeight: 1.5 }}>
        {message}
      </p>
      <p style={{ color: '#667085', fontSize: 12 }}>Payments securely processed by Stripe</p>
    </form>
  );
}
/** Remount with key={session.id} when starting a different Checkout Session. */
export function SafeCheckout(props: SafeCheckoutProps) {
  if (!/^pk_(test|live)_[A-Za-z0-9]+$/.test(props.publishableKey))
    throw new Error('SafeCheckout requires a Stripe publishable key');
  const stripe = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  const [attempt, setAttempt] = useState(0);
  const options = useMemo(
    () => ({
      clientSecret: props.clientSecret,
      elementsOptions: {
        appearance: props.appearance ?? {
          theme: 'stripe' as const,
          variables: {
            colorPrimary: '#635bff',
            borderRadius: '10px',
            fontFamily: 'system-ui, sans-serif',
          },
        },
      },
    }),
    [props.clientSecret, props.appearance],
  );
  return (
    <section className={props.className} style={{ ...card, ...props.style }}>
      {props.children}
      <CheckoutElementsProvider key={attempt} stripe={stripe} options={options}>
        <PaymentForm {...props} retry={() => setAttempt((value) => value + 1)} />
      </CheckoutElementsProvider>
    </section>
  );
}
