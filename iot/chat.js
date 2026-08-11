/* Chat over the digital twin — posts the LIVE telemetry snapshot to /api/chat,
   which routes to Bedrock AgentCore (or falls back). Reads globals from app.js:
   ZONES, currentT, statusOf, timeLabel. */
(function () {
  const dock = document.getElementById('chat-dock');
  const msgs = document.getElementById('chat-msgs');
  const input = document.getElementById('chat-in');
  const srcBadge = document.getElementById('chat-src');

  function snapshot() {
    const t = currentT;
    const zones = ZONES.map(z => ({
      name: z.name,
      temp: +z.series.temp[t],
      hum: z.series.hum[t],
      vib: z.series.vib[t],
      status: statusOf(z.series.temp[t]),
    }));
    const avg = +(zones.reduce((s, z) => s + z.temp, 0) / zones.length).toFixed(1);
    const peak = [...zones].sort((a, b) => b.temp - a.temp)[0].name;
    return { time: timeLabel(t) + ' h', zones, avg, peak };
  }

  function bubble(text, who, src) {
    const d = document.createElement('div');
    d.className = 'msg ' + who;
    d.innerHTML = who === 'bot' && src
      ? `<span class="src-tag ${src}">${src}</span>${escapeHtml(text)}`
      : escapeHtml(text);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  const escapeHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  async function ask(q) {
    if (!q.trim()) return;
    bubble(q, 'user');
    input.value = '';
    const thinking = bubble('…', 'bot');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, snapshot: snapshot() }),
      });
      const d = await r.json();
      thinking.remove();
      bubble(d.answer || '(no answer)', 'bot', d.source || 'offline');
      if (d.source) srcBadge.textContent = d.source === 'agentcore' ? 'AgentCore'
        : d.source === 'bedrock' ? 'Bedrock' : 'offline';
    } catch (e) {
      thinking.remove();
      bubble('Chat backend unreachable — is the Node server running? (' + e.message + ')', 'bot', 'offline');
    }
  }

  document.getElementById('chat-send').onclick = () => ask(input.value);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(input.value); });
  document.querySelectorAll('.chat-chips button').forEach(b => b.onclick = () => ask(b.textContent));
  document.getElementById('chat-toggle').onclick = () => dock.classList.toggle('collapsed');
  document.getElementById('chat-min').onclick = () => dock.classList.add('collapsed');

  // greeting
  bubble('Ask me about the plant floor — alarms, hottest zone, a specific zone, or a summary. Grounded in the live telemetry at the current time.', 'bot', 'agentcore');
})();
