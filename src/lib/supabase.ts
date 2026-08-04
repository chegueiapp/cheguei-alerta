import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Mesmo projeto Supabase do cheguei-app/cheguei-mobile/mobile-parceiros. A sessão fica
// persistida no localStorage do próprio webview do Tauri (perfil do WebView2, isolado por
// app), então o parceiro loga uma vez e o app volta a conectar sozinho nas próximas vezes
// que o Windows iniciar.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
