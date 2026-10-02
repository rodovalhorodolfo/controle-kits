export function createAuth(supabase, callbacks = {}) {
  async function login() {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) throw error;
  }

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user || null;
  }

  supabase.auth.onAuthStateChange((event, session) => {
    callbacks.onChange?.(session?.user || null, event);
  });

  return { login, logout, getUser };
}
