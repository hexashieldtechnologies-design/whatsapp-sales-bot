// /health — liveness/status endpoint.
import express from 'express';

const router = express.Router();

export function makeHealthRouter(getStatus) {
  router.get('/', (req, res) => {
    const status = getStatus ? getStatus() : { connected: false };
    res.json({
      ok: true,
      service: 'whatsapp-assistant',
      whatsapp: status.connected ? 'connected' : 'disconnected',
      phone: status.me || null,
      uptime: Math.round(process.uptime()),
    });
  });
  return router;
}

export default makeHealthRouter;
