/* Выход: гасим куку сессии. */
import { clearCookie } from '../lib/auth.js';

export default {
  async fetch(request) {
    const headers = { 'set-cookie': clearCookie(), 'cache-control': 'no-store' };
    if (request.method === 'POST') {
      return new Response(null, { status: 303, headers: { ...headers, location: '/' } });
    }
    return new Response(null, { status: 303, headers: { ...headers, location: '/' } });
  },
};
