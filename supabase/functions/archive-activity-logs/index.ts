import { createArchiveWorker } from './core.mjs'
// Scheduler-only endpoint. Manual authentication uses a random Vault token
// checked by a service-role-only RPC. No token/key is exposed to the browser.
Deno.serve(createArchiveWorker({
 url: Deno.env.get('SUPABASE_URL'),
 key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}))
