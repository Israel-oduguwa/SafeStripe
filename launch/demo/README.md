# Paid once. Processed twice?

A 30-second beginner-friendly explainer of repeated payment updates. A customer buys 100 demo credits for $5. A repeated “paid” message illustrates how an unguarded application could add those credits twice. SafeStripe's sender verification, durable admission and protection of the saved result are then explained in plain language.

The credit purchase and duplicate-credit failure are illustrations, not an observed incident or a tested credit balance. The measured result is a real Stripe sandbox replay check: ten additional duplicate admissions left the original Firestore receipt and paid time unchanged. It comes from the [retained report](../../docs/evidence/stripe-lifecycle-2026-10-07.json) and [protected workflow](https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941), recorded on 7 October 2026 using the published `safestripe@0.3.0` package. Timing is edited; the film is not screen footage.

Application developers must still define stable operation and effect identities and implement authorization. Downstream outbox receivers must handle repeated deliveries. The film does not claim automatic recovery of declined cards, exactly-once external delivery or enterprise throughput. See the [reliability contracts](../../docs/24-reliability-contracts.md) and [coverage boundaries](../../docs/30-payment-lifecycle.md).

## Files

- `safestripe-recovery-4k.mp4`: native 3840 × 2160 master.
- `safestripe-recovery-vertical-4k.mp4`: native 2160 × 3840 portrait master.
- `safestripe-recovery.mp4` and `safestripe-recovery-vertical.mp4`: HD web copies made from those masters.
- `poster.jpg`, `poster-vertical.jpg` and `captions.vtt`: web previews and text captions.
- `manifest.json`: retained evidence hash, music source, sound cues, encoding, measured loudness and full decode checks.
- `render_explainer.py`: editable motion source, under the repository's MIT license. Fonts are drawn at native 4K resolution; they are not enlarged from an HD render.

All four films last 30 seconds at 30 fps. This edition has no narration. Its complete explanation is carried by on-screen text and captions. The original timed effects include clicks, pops, whooshes and confirmation tones. The licensed rhythmic soundtrack is mixed around those effects and normalized for web playback; see [media credits](MEDIA-NOTICES.md).

## Re-render

Install Pillow, NumPy and FFmpeg. The current source uses Arial, Georgia and Menlo fonts installed on macOS; set `FONT_PATHS` to your licensed local equivalents on another system.

Download “Close Up” from [Mixkit's corporate music catalog](https://mixkit.co/free-stock-music/corporate-music/) and place the MP3 in the ignored `.media/close-up.mp3` directory, or pass its location with `--music`. The source checksum is checked before rendering. The standalone music file must not be committed or published with the software.

```sh
python3 launch/demo/render_explainer.py --review-only
python3 launch/demo/render_explainer.py --music /absolute/path/to/close-up.mp3
```

Review the contact sheets in both formats first. Rendering checks the retained evidence, generates native 4K masters and HD web copies, decodes every video, and measures the encoded audio's loudness and true peak. These checks do not rerun Stripe or validate a newer npm release.
