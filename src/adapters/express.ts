import type { RequestHandler } from 'express';
import type { WebhookReceiver } from '../webhooks.js';
import { publicError } from '../errors.js';

/** Mount express.raw BEFORE express.json, with inflate:false and matching body limit. */
export function expressWebhook(receiver: WebhookReceiver): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'RAW_BODY_REQUIRED' });
      return;
    }
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') {
      res.status(415).json({ error: 'UNSUPPORTED_ENCODING' });
      return;
    }
    try {
      res.status(200).json(await receiver.receive(req.body, req.get('stripe-signature')));
    } catch (error) {
      const response = publicError(error);
      res.status(response.status).json(response.body);
    }
  };
}
