import CheckoutForm from './checkout-form.js';
export default function Page() {
  return (
    <main style={{ maxWidth: 720, margin: '60px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>SafeStripe sandbox</h1>
      <p>Enter your local demo token to open the payment form. The server holds your secret key.</p>
      <CheckoutForm publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''} />
    </main>
  );
}
