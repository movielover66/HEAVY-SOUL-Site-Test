/* HEAVY SOUL — floating "Chat with us" button (links to the on-site support chat) */
(function () {
  'use strict';
  if (document.getElementById('hsLauncher')) return;
  if (/cart/.test(location.pathname) && window.innerWidth < 760) return; // keep the bag's checkout bar clear on phones
  var a = document.createElement('a');
  a.id = 'hsLauncher'; a.href = 'support.html'; a.setAttribute('aria-label', 'Chat with Heavy Soul support');
  a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4V5Z"/><circle cx="9" cy="10.5" r=".6" fill="currentColor"/><circle cx="12" cy="10.5" r=".6" fill="currentColor"/><circle cx="15" cy="10.5" r=".6" fill="currentColor"/></svg><span>Help</span>';
  var s = document.createElement('style');
  s.textContent = '#hsLauncher{position:fixed;right:16px;bottom:16px;z-index:90;display:flex;align-items:center;gap:8px;padding:12px 18px 12px 14px;border-radius:999px;background:var(--hs-accent,#C42B38);color:#fff;font:600 13px/1 var(--sans,system-ui);text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.45);transition:transform .2s,box-shadow .2s}#hsLauncher:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.55)}#hsLauncher svg{width:20px;height:20px}@media(max-width:600px){#hsLauncher span{display:none}#hsLauncher{padding:13px}}';
  document.head.appendChild(s); document.body.appendChild(a);
})();
