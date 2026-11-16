import { VeskResponse } from '@vesk/runtime/server';

export async function GET() {
  return VeskResponse.json({ source: 'mw-rewrite' });
}
