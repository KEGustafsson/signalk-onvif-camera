'use strict';

import type { HttpResponseLike, SignalKAppLike } from '../types';

function authorizeRequest(app: SignalKAppLike, req: unknown, res?: HttpResponseLike): boolean {
  if (app.securityStrategy && typeof app.securityStrategy.shouldAllowRequest === 'function') {
    if (!app.securityStrategy.shouldAllowRequest(req, 'READ')) {
      if (res) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
      }
      return false;
    }
  }
  return true;
}

module.exports = {
  authorizeRequest
};
