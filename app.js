(() => {
  'use strict';

  const config = window.SUGARHILL_CONFIG || {};
  const requiredConfigMissing = !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY ||
    config.SUPABASE_URL.includes('YOUR_PROJECT_REF') || config.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');
  const supabaseLib = window.supabase;
  const db = (!requiredConfigMissing && supabaseLib)
    ? supabaseLib.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  let currentChatId = null;
  let chats = {};
  let currentUser = null;
  let sending = false;

  const $ = (id) => document.getElementById(id);
  const themeSelect = $('theme-select');
  const sidebar = $('sidebar');
  const mobileOverlay = $('mobile-overlay');
  const chatForm = $('chat-form');
  const userInput = $('user-input');
  const chatMessages = $('chat-messages');
  const welcomeScreen = $('welcome-screen');
  const chatHistoryList = $('chat-history-list');
  const currentChatTitle = $('current-chat-title');
  const authModal = $('auth-modal');
  const settingsModal = $('settings-modal');
  const userProfile = $('user-profile');
  const authButtons = $('auth-buttons');
  const userName = $('user-name');
  const userEmail = $('user-email');

  function toast(message, isError = false) {
    const node = document.createElement('div');
    node.className = `fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl border text-xs shadow-xl ${isError ? 'bg-red-950 border-red-800 text-red-200' : 'bg-theme-card border-theme text-theme-main'}`;
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function ensureConfigured() {
    if (!db) {
      toast('Hubungkan Supabase terlebih dahulu melalui config.js.', true);
      return false;
    }
    return true;
  }

  // Theme behavior is kept identical to the base template.
  const savedTheme = localStorage.getItem('aura_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeSelect.value = savedTheme;
  themeSelect.addEventListener('change', (e) => {
    document.documentElement.setAttribute('data-theme', e.target.value);
    localStorage.setItem('aura_theme', e.target.value);
  });

  $('open-sidebar-btn').addEventListener('click', () => {
    sidebar.classList.remove('-translate-x-full');
    mobileOverlay.classList.remove('hidden');
  });
  function closeMobileSidebar() {
    sidebar.classList.add('-translate-x-full');
    mobileOverlay.classList.add('hidden');
  }
  $('close-sidebar-btn').addEventListener('click', closeMobileSidebar);
  mobileOverlay.addEventListener('click', closeMobileSidebar);

  $('toggle-library-btn').addEventListener('click', () => {
    $('prompt-library-panel').classList.toggle('hidden');
    $('library-chevron').classList.toggle('rotate-180');
  });
  window.injectPrompt = (promptText) => {
    userInput.value = promptText;
    userInput.focus();
    if (window.innerWidth < 768) closeMobileSidebar();
  };

  function updateUserUI() {
    if (currentUser) {
      userProfile.classList.remove('hidden');
      authButtons.classList.add('hidden');
      userName.textContent = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'Pengguna';
      userEmail.textContent = currentUser.email || '';
    } else {
      userProfile.classList.add('hidden');
      authButtons.classList.remove('hidden');
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderHistory() {
    chatHistoryList.innerHTML = '';
    Object.values(chats).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).forEach((chat) => {
      const item = document.createElement('div');
      item.className = `group flex items-center justify-between p-2 rounded-xl text-xs cursor-pointer transition border ${chat.id === currentChatId ? 'bg-theme-card border-theme text-white font-semibold' : 'border-transparent text-theme-muted hover:bg-theme-hover'}`;
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'flex items-center space-x-2 truncate pr-1 text-left min-w-0 flex-1';
      open.innerHTML = '<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>';
      const title = document.createElement('span');
      title.className = 'truncate';
      title.textContent = chat.title || 'Percakapan Baru';
      open.appendChild(title);
      open.addEventListener('click', () => loadChat(chat.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Hapus percakapan';
      del.className = 'opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition';
      del.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
      del.addEventListener('click', (event) => deleteChat(chat.id, event));
      item.append(open, del);
      chatHistoryList.appendChild(item);
    });
  }

  async function refreshChats(preferredId = null) {
    if (!currentUser || !db) { chats = {}; currentChatId = null; renderHistory(); renderChat(); return; }
    const { data, error } = await db.from('conversations').select('id,title,created_at,updated_at').order('updated_at', { ascending: false });
    if (error) throw error;
    chats = {};
    (data || []).forEach(c => chats[c.id] = { ...c, messages: [] });
    const ids = Object.keys(chats);
    if (ids.length) {
      const { data: messages, error: messageError } = await db.from('messages').select('id,conversation_id,role,content,created_at').in('conversation_id', ids).order('created_at', { ascending: true });
      if (messageError) throw messageError;
      (messages || []).forEach(m => chats[m.conversation_id]?.messages.push({ role: m.role, content: m.content }));
    }
    currentChatId = preferredId && chats[preferredId] ? preferredId : (ids[0] || null);
    renderHistory();
    renderChat();
  }

  async function createNewChat() {
    if (!ensureConfigured()) return;
    if (!currentUser) { authModal.classList.remove('hidden'); toast('Masuk untuk menyimpan percakapan.'); return; }
    const { data, error } = await db.from('conversations').insert({ user_id: currentUser.id, title: 'Percakapan Baru' }).select('id,title,created_at,updated_at').single();
    if (error) { toast('Gagal membuat percakapan: ' + error.message, true); return; }
    chats[data.id] = { ...data, messages: [] };
    currentChatId = data.id;
    renderHistory(); renderChat();
    if (window.innerWidth < 768) closeMobileSidebar();
  }

  async function loadChat(id) {
    if (!chats[id]) return;
    currentChatId = id;
    renderHistory(); renderChat();
    if (window.innerWidth < 768) closeMobileSidebar();
  }

  async function deleteChat(id, event) {
    event?.stopPropagation();
    if (!ensureConfigured() || !currentUser) return;
    const { error } = await db.from('conversations').delete().eq('id', id);
    if (error) { toast('Gagal menghapus percakapan: ' + error.message, true); return; }
    delete chats[id];
    if (currentChatId === id) currentChatId = null;
    renderHistory(); renderChat();
  }

  function appendMessageUI(role, content) {
    const isUser = role === 'user';
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'} w-full`;
    const bubble = document.createElement('div');
    bubble.className = `max-w-[85%] sm:max-w-[75%] p-4 rounded-2xl border text-xs md:text-sm leading-relaxed ${isUser ? 'chat-bubble-user rounded-tr-none' : 'chat-bubble-ai rounded-tl-none markdown-body'}`;
    if (isUser) bubble.textContent = content;
    else {
      const html = window.marked ? marked.parse(content) : escapeHTML(content).replace(/\n/g, '<br>');
      bubble.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : escapeHTML(content).replace(/\n/g, '<br>');
    }
    msgDiv.appendChild(bubble);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return bubble;
  }

  function renderChat() {
    chatMessages.innerHTML = '';
    const chat = currentChatId ? chats[currentChatId] : null;
    if (!chat || !chat.messages?.length) {
      chatMessages.appendChild(welcomeScreen);
      currentChatTitle.textContent = 'Percakapan Baru';
      return;
    }
    currentChatTitle.textContent = chat.title || 'Percakapan Baru';
    chat.messages.forEach(m => appendMessageUI(m.role, m.content));
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function persistMessage(conversationId, role, content) {
    const { error } = await db.from('messages').insert({ conversation_id: conversationId, role, content });
    if (error) throw error;
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = userInput.value.trim();
    if (!text || sending) return;
    if (!ensureConfigured()) return;
    if (!currentUser) { authModal.classList.remove('hidden'); toast('Masuk terlebih dahulu untuk mulai chat.'); return; }
    if (!currentChatId) {
      const { data, error } = await db.from('conversations').insert({ user_id: currentUser.id, title: text.length > 25 ? text.slice(0, 25) + '...' : text }).select('id,title,created_at,updated_at').single();
      if (error) { toast('Gagal membuat percakapan: ' + error.message, true); return; }
      chats[data.id] = { ...data, messages: [] };
      currentChatId = data.id;
    }
    const chat = chats[currentChatId];
    if (!chat.messages.length) {
      chat.title = text.length > 25 ? text.slice(0, 25) + '...' : text;
      const { error } = await db.from('conversations').update({ title: chat.title, updated_at: new Date().toISOString() }).eq('id', currentChatId);
      if (error) { toast('Gagal memperbarui judul chat.', true); return; }
    }
    sending = true;
    $('send-btn').disabled = true;
    chat.messages.push({ role: 'user', content: text });
    userInput.value = '';
    renderHistory(); renderChat();
    const loading = appendMessageUI('model', 'Sedang memproses...');
    try {
      await persistMessage(currentChatId, 'user', text);
      const { data: { session } } = await db.auth.getSession();
      const response = await fetch(`${config.SUPABASE_URL}/functions/v1/${config.FUNCTION_NAME || 'chat'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': config.SUPABASE_ANON_KEY },
        body: JSON.stringify({ messages: chat.messages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', content: m.content })) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Backend error (${response.status})`);
      const answer = payload.reply;
      if (!answer) throw new Error('Backend tidak mengembalikan jawaban.');
      await persistMessage(currentChatId, 'assistant', answer);
      chat.messages.push({ role: 'assistant', content: answer });
      const { error: updateError } = await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', currentChatId);
      if (updateError) console.warn(updateError);
      renderHistory(); renderChat();
    } catch (error) {
      loading.innerHTML = `<span class="text-red-400">${escapeHTML(error.message || 'Gagal mengambil respons.')}</span>`;
      // Keep the user message in the local view; it is already saved if the insert succeeded.
      toast('Gagal mendapatkan respons AI.', true);
    } finally {
      sending = false;
      $('send-btn').disabled = false;
      userInput.focus();
    }
  }
  chatForm.addEventListener('submit', sendMessage);
  $('new-chat-btn').addEventListener('click', createNewChat);

  $('open-auth-modal').addEventListener('click', () => authModal.classList.remove('hidden'));
  $('close-auth-modal').addEventListener('click', () => authModal.classList.add('hidden'));
  $('open-settings-btn').addEventListener('click', () => settingsModal.classList.remove('hidden'));
  $('close-settings-modal').addEventListener('click', () => settingsModal.classList.add('hidden'));
  $('save-api-key-btn').addEventListener('click', () => settingsModal.classList.add('hidden'));

  $('google-login-btn').addEventListener('click', async () => {
    if (!ensureConfigured()) return;
    const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
    if (error) toast(error.message, true);
  });

  $('email-login-btn').addEventListener('click', async () => {
    if (!ensureConfigured()) return;
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) { toast('Isi email dan kata sandi terlebih dahulu.', true); return; }
    const button = $('email-login-btn');
    button.disabled = true;
    try {
      let result = await db.auth.signInWithPassword({ email, password });
      if (result.error && /invalid login credentials/i.test(result.error.message)) {
        result = await db.auth.signUp({ email, password });
      }
      if (result.error) throw result.error;
      if (!result.data.session) {
        toast('Periksa email untuk konfirmasi akun sebelum masuk.');
      } else {
        authModal.classList.add('hidden');
        toast('Berhasil masuk.');
      }
    } catch (error) { toast(error.message || 'Autentikasi gagal.', true); }
    finally { button.disabled = false; }
  });

  $('logout-btn').addEventListener('click', async () => {
    if (!db) return;
    const { error } = await db.auth.signOut();
    if (error) toast(error.message, true);
  });

  async function boot() {
    if (requiredConfigMissing || !supabaseLib) {
      updateUserUI(); renderHistory(); renderChat();
      console.warn('Lengkapi config.js dengan URL dan anon key Supabase.');
      return;
    }
    const { data: { session } } = await db.auth.getSession();
    currentUser = session?.user || null;
    updateUserUI();
    if (currentUser) {
      try { await refreshChats(); }
      catch (error) { toast('Gagal memuat riwayat chat: ' + error.message, true); }
    } else { renderHistory(); renderChat(); }
    db.auth.onAuthStateChange(async (_event, sessionNow) => {
      currentUser = sessionNow?.user || null;
      updateUserUI();
      try { await refreshChats(); }
      catch (error) { toast('Gagal memuat riwayat chat: ' + error.message, true); }
    });
  }
  boot();
})();
