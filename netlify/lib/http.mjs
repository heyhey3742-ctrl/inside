import { UserError } from './booking.mjs';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export function handle(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (e) {
      if (e instanceof UserError) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: '系統發生錯誤，請稍後再試' }, 500);
    }
  };
}

export async function formParams(req) {
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

export const originOf = (req) => process.env.URL_OVERRIDE || new URL(req.url).origin;
