import { VeskResponse } from '@vesk/runtime/server';

export async function GET() {
  return VeskResponse.json({ target: 'mw-rewrite-target' });
}
