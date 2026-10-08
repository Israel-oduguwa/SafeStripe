# A failed payment. A clean recovery.

A 30-second film for the SafeStripe website and launch posts. The film is a custom editorial reconstruction of real Stripe sandbox checks, with edited timing. It is not screen footage, live-money evidence or a throughput measurement.

The card journey shows Stripe declining the insufficient-funds test card, the order remaining unpaid, and a customer retrying with a working test card in the same Checkout Session. The retry reaches its authenticated Firestore receipt. SafeStripe does not override a card decline; the customer changes the card.

The duplicate-delivery sequence is clearly labeled as a **separate replay check**. Ten additional duplicate admissions leave that earlier payment's original receipt and paid time unchanged. It is not presented as ten replays of the declined-card journey.

Both journeys come from the [retained report](../../docs/evidence/stripe-lifecycle-2026-10-07.json) and [protected workflow](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941), recorded on 7 October 2026. The published package was `safestripe@0.3.0`, using Stripe SDK 22.6.2 and API version `2026-08-26.dahlia`. See the [complete coverage boundaries](../../docs/30-payment-lifecycle.md).

## Deliverables

- `safestripe-recovery.mp4`: 1920 × 1080, 30 seconds, 30 fps.
- `safestripe-recovery-vertical.mp4`: 1080 × 1920, 30 seconds, 30 fps.
- `poster.jpg` and `poster-vertical.jpg`: preview images.
- `captions.vtt`: optional text captions. The film also carries readable text on screen.
- `manifest.json`: source evidence hash, encoding information and decode checks.
- `render_demo.py`: editable motion source. The source uses the repository's MIT license; it does not bundle third-party font files or sampled music.

The soundtrack consists of original quiet tones and transition cues. There is no narration, and the story works with the sound off.

## Re-render

Install Pillow and NumPy in your Python environment and install FFmpeg from its official distribution. The current render uses the standard Arial, Georgia and Menlo fonts installed on macOS. Set `FONT_PATHS` in the source to your licensed local equivalents on another system.

```sh
python3 launch/demo/render_demo.py --review-only
python3 launch/demo/render_demo.py
```

Review the six contact-sheet frames in each format before rendering. The renderer checks the source evidence, writes 900 frames per output, verifies the duration and codecs, and decodes the complete MP4. Render checks do not rerun Stripe or verify a newer npm package.
