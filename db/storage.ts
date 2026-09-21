import { env } from 'cloudflare:workers';
export function storage(){if(!env.DB || !env.BUCKET)throw new Error('Storage unavailable');return {db:env.DB,bucket:env.BUCKET};}
