;(function () {
  'use strict'

  /* ========== 配置 ========== */
  var script = document.currentScript
  var SERVER = (script && script.getAttribute('data-server')) || ''
  var THEME = (script && script.getAttribute('data-color')) || '#2563eb'
  var POS   = (script && script.getAttribute('data-position')) || 'right'
  var TOKEN = (script && script.getAttribute('data-token')) || ''
  var POLL  = 3000
  var LS_KEY = 'goosd_visitor_id'
  var LS_NAME_KEY = 'goosd_visitor_name'
  var LS_TOKEN_KEY = 'goosd_visitor_token'

  /* ========== 状态 ========== */
  var visitorId = localStorage.getItem(LS_KEY) || ''
  var visitorToken = localStorage.getItem(LS_TOKEN_KEY) || ''
  var convId = null
  var lastMsgId = 0
  var pollTimer = null
  var isOpen = false
  var cfg = { welcomeText: '', quickQuestions: [] }

  /* ========== 工具 ========== */
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } }
    if (body) opts.body = JSON.stringify(body)
    return fetch(SERVER + '/api/widget' + path, opts).then(function (r) { return r.json() })
  }

  function esc(s) {
    var d = document.createElement('div'); d.textContent = s; return d.innerHTML
  }

  function timeStr(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  /* ========== 样式 ========== */
  var css = document.createElement('style')
  css.textContent = [
    /* FAB 浮动按钮 */
    '#gw-chat-fab{position:fixed;z-index:99998;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;' + (POS === 'left' ? 'left:20px;' : 'right:20px;') + 'bottom:24px;background:' + THEME + ';}',
    '#gw-chat-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(0,0,0,.24);}',
    '#gw-chat-fab svg{width:28px;height:28px;fill:#fff;}',
    '#gw-chat-fab .gw-unread{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff;font-family:system-ui,sans-serif;}',

    /* 聊天窗口 */
    '#gw-chat-win{position:fixed;z-index:99999;width:380px;height:560px;' + (POS === 'left' ? 'left:20px;' : 'right:20px;') + 'bottom:90px;border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;}',
    '#gw-chat-win.open{display:flex;}',

    /* 顶栏 */
    '#gw-chat-head{display:flex;align-items:center;gap:12px;padding:14px 18px;color:#fff;flex-shrink:0;background:' + THEME + ';}',
    '#gw-chat-head .gw-head-ava{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;}',
    '#gw-chat-head .gw-head-ava svg{width:20px;height:20px;fill:#fff;}',
    '#gw-chat-head .gw-head-info{flex:1;}',
    '#gw-chat-head .gw-head-info strong{display:block;font-size:15px;font-weight:700;}',
    '#gw-chat-head .gw-head-info small{font-size:12px;opacity:.8;}',
    '#gw-chat-close{width:32px;height:32px;border-radius:8px;border:none;background:rgba(255,255,255,.15);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}',
    '#gw-chat-close:hover{background:rgba(255,255,255,.3);}',

    /* 消息体 */
    '#gw-chat-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;scrollbar-width:none;}',
    '#gw-chat-body::-webkit-scrollbar{display:none;}',

    /* 欢迎区 */
    '.gw-welcome{text-align:center;padding:20px 12px 10px;}',
    '.gw-welcome .gw-w-icon{width:52px;height:52px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;background:' + THEME + '15;}',
    '.gw-welcome .gw-w-icon svg{width:26px;height:26px;fill:' + THEME + ';}',
    '.gw-welcome p{font-size:14px;color:#475569;line-height:1.6;margin:0;}',

    /* 快捷问题 */
    '.gw-faq-wrap{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:0 8px;}',
    '.gw-faq-btn{padding:6px 14px;border-radius:18px;border:1px solid #e2e8f0;background:#fff;font-size:13px;color:#475569;cursor:pointer;transition:all .15s;white-space:nowrap;}',
    '.gw-faq-btn:hover{border-color:' + THEME + ';color:' + THEME + ';background:#eff6ff;}',

    /* 时间线 */
    '.gw-time-div{align-self:center;padding:6px 0;}',
    '.gw-time-div span{font-size:11px;color:#94a3b8;background:rgba(148,163,184,.1);padding:2px 10px;border-radius:8px;}',

    /* 消息行 */
    '.gw-msg{display:flex;gap:8px;max-width:82%;animation:gw-fadein .2s ease;}',
    '.gw-msg.gw-out{align-self:flex-end;flex-direction:row-reverse;}',
    '.gw-msg-ava{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;}',
    '.gw-msg.gw-in .gw-msg-ava{background:' + THEME + ';}',
    '.gw-msg.gw-out .gw-msg-ava{background:#64748b;}',
    '.gw-msg-body{display:flex;flex-direction:column;gap:2px;min-width:0;}',
    '.gw-msg.gw-out .gw-msg-body{align-items:flex-end;}',

    /* 气泡 */
    '.gw-bub{padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.6;word-break:break-word;max-width:100%;}',
    '.gw-msg.gw-in .gw-bub{background:#fff;color:#1e293b;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.05);}',
    '.gw-msg.gw-out .gw-bub{background:' + THEME + ';color:#fff;border-bottom-right-radius:4px;box-shadow:0 2px 8px ' + THEME + '33;}',
    '.gw-bub img{display:block;max-width:180px;max-height:160px;border-radius:10px;cursor:pointer;}',
    '.gw-bub-ts{font-size:10px;color:#b0b8c6;padding:0 4px;}',

    /* 语音气泡 */
    '.gw-voice-bub{display:flex!important;align-items:center;gap:8px;padding:12px 16px!important;min-width:80px;max-width:160px;cursor:pointer;user-select:none;}',
    '.gw-voice-bub:active{opacity:.7;}',
    '.gw-voice-wave{display:flex;align-items:flex-end;gap:2px;height:18px;}',
    '.gw-msg.gw-in .gw-voice-wave{flex-direction:row-reverse;}',
    '.gw-voice-wave i{display:block;width:3px;border-radius:2px;background:currentColor;opacity:.4;font-style:normal;}',
    '.gw-voice-wave i:nth-child(1){height:6px;}',
    '.gw-voice-wave i:nth-child(2){height:12px;}',
    '.gw-voice-wave i:nth-child(3){height:18px;}',
    '.gw-voice-bub.playing .gw-voice-wave i{animation:gw-vani 1s ease-in-out infinite;opacity:1;}',
    '.gw-voice-bub.playing .gw-voice-wave i:nth-child(1){animation-delay:0s;}',
    '.gw-voice-bub.playing .gw-voice-wave i:nth-child(2){animation-delay:.15s;}',
    '.gw-voice-bub.playing .gw-voice-wave i:nth-child(3){animation-delay:.3s;}',
    '@keyframes gw-vani{0%,100%{opacity:.3;}50%{opacity:1;}}',
    '.gw-voice-dur{font-size:12px;font-weight:600;opacity:.8;white-space:nowrap;}',

    /* 输入区 */
    '#gw-chat-foot{flex-shrink:0;background:#fff;border-top:1px solid #f1f5f9;padding:10px 14px;}',
    '#gw-chat-foot .gw-foot-row{display:flex;align-items:center;gap:8px;}',
    '#gw-chat-foot .gw-foot-tools{display:flex;gap:2px;margin-bottom:6px;}',
    '.gw-tool-btn{width:30px;height:30px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:#94a3b8;display:flex;align-items:center;justify-content:center;transition:all .12s;}',
    '.gw-tool-btn:hover{background:#f1f5f9;color:' + THEME + ';}',
    '#gw-chat-foot input[type=text]{flex:1;border:none;outline:none;font-size:14px;color:#1e293b;background:transparent;padding:8px 0;}',
    '#gw-chat-foot input::placeholder{color:#94a3b8;}',
    '#gw-chat-foot .gw-send{width:36px;height:36px;border-radius:50%;border:none;background:' + THEME + ';color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;box-shadow:0 2px 8px ' + THEME + '33;}',
    '#gw-chat-foot .gw-send:hover{transform:translateY(-1px);box-shadow:0 4px 14px ' + THEME + '44;}',
    '#gw-chat-foot .gw-send:disabled{opacity:.35;pointer-events:none;box-shadow:none;}',

    /* emoji 面板 */
    '.gw-emoji-panel{position:absolute;bottom:44px;left:0;width:280px;max-height:200px;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.14),0 0 0 1px rgba(0,0,0,.04);overflow-y:auto;padding:8px;display:none;z-index:10;}',
    '.gw-emoji-panel.show{display:block;}',
    '.gw-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:1px;}',
    '.gw-emoji-grid button{width:32px;height:32px;border:none;background:transparent;cursor:pointer;font-size:18px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:background .1s,transform .1s;}',
    '.gw-emoji-grid button:hover{background:#f1f5f9;transform:scale(1.2);}',

    /* 图片预览 */
    '#gw-preview{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.78);display:none;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);}',
    '#gw-preview.show{display:flex;}',
    '#gw-preview img{max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.4);object-fit:contain;}',

    '@keyframes gw-fadein{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}',

    /* 手机全屏 */
    '@media(max-width:480px){',
    '  #gw-chat-win{width:100vw;height:100vh;bottom:0;left:0;right:0;border-radius:0;}',
    '}'
  ].join('\n')
  document.head.appendChild(css)

  /* ========== DOM 构建 ========== */

  // 浮动按钮
  var fab = document.createElement('button')
  fab.id = 'gw-chat-fab'
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>'
  fab.title = '在线客服'
  fab.onclick = toggleChat
  document.body.appendChild(fab)

  // 未读红点
  var unreadBadge = document.createElement('span')
  unreadBadge.className = 'gw-unread'
  unreadBadge.style.display = 'none'
  fab.appendChild(unreadBadge)
  var unreadCount = 0

  // 聊天窗口
  var win = document.createElement('div')
  win.id = 'gw-chat-win'
  win.innerHTML = [
    '<div id="gw-chat-head">',
    '  <div class="gw-head-ava"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>',
    '  <div class="gw-head-info"><strong>在线客服</strong><small>有问题随时问我</small></div>',
    '  <button id="gw-chat-close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>',
    '</div>',
    '<div id="gw-chat-body"></div>',
    '<div id="gw-chat-foot">',
    '  <div class="gw-foot-tools" style="position:relative;">',
    '    <button type="button" class="gw-tool-btn" id="gw-emoji-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>',
    '    <button type="button" class="gw-tool-btn" id="gw-img-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></button>',
    '    <div class="gw-emoji-panel" id="gw-emoji-panel"></div>',
    '  </div>',
    '  <div class="gw-foot-row">',
    '    <input type="text" id="gw-input" placeholder="请输入您的问题..." autocomplete="off" />',
    '    <button type="button" class="gw-send" id="gw-send-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
    '  </div>',
    '</div>'
  ].join('\n')
  document.body.appendChild(win)

  // 图片预览层
  var preview = document.createElement('div')
  preview.id = 'gw-preview'
  preview.innerHTML = '<img />'
  preview.onclick = function () { preview.classList.remove('show') }
  document.body.appendChild(preview)

  // 隐藏文件选择
  var fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.style.display = 'none'
  fileInput.onchange = onFilePick
  document.body.appendChild(fileInput)

  /* ========== 引用 ========== */
  var body     = win.querySelector('#gw-chat-body')
  var inp      = win.querySelector('#gw-input')
  var sendBtn  = win.querySelector('#gw-send-btn')
  var closeBtn = win.querySelector('#gw-chat-close')
  var emojiBtn = win.querySelector('#gw-emoji-btn')
  var emojiPanel = win.querySelector('#gw-emoji-panel')
  var imgBtn   = win.querySelector('#gw-img-btn')

  /* ========== 事件绑定 ========== */
  closeBtn.onclick = toggleChat
  sendBtn.onclick  = send
  imgBtn.onclick   = function () { fileInput.click() }
  inp.onkeydown    = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  // emoji 面板
  var emojis = ['😀','😁','😂','🤣','😊','😍','🥰','😘','😋','😎','🤩','😏','😢','😭','😤','😡','🥺','😱','🤗','🤔','👍','👎','👏','🙏','💪','❤️','🔥','⭐','🎉','✅']
  var grid = document.createElement('div')
  grid.className = 'gw-emoji-grid'
  emojis.forEach(function (e) {
    var b = document.createElement('button')
    b.type = 'button'
    b.textContent = e
    b.onclick = function () { inp.value += e; emojiPanel.classList.remove('show') }
    grid.appendChild(b)
  })
  emojiPanel.appendChild(grid)
  emojiBtn.onclick = function (ev) {
    ev.stopPropagation()
    emojiPanel.classList.toggle('show')
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.gw-emoji-panel') && !e.target.closest('#gw-emoji-btn')) {
      emojiPanel.classList.remove('show')
    }
  })

  /* ========== 语音播放 ========== */
  var currentAudio = null
  var currentVoiceDom = null

  function playVoice(dom, src) {
    if (currentVoiceDom === dom && currentAudio) {
      currentAudio.pause(); currentAudio = null
      dom.classList.remove('playing'); currentVoiceDom = null
      return
    }
    if (currentAudio) {
      currentAudio.pause()
      if (currentVoiceDom) currentVoiceDom.classList.remove('playing')
    }
    var a = new Audio(src)
    currentAudio = a; currentVoiceDom = dom
    dom.classList.add('playing')
    a.onended = function () { dom.classList.remove('playing'); currentAudio = null; currentVoiceDom = null }
    a.onerror = function () { dom.classList.remove('playing'); currentAudio = null; currentVoiceDom = null }
    a.play().catch(function () { dom.classList.remove('playing'); currentAudio = null; currentVoiceDom = null })
  }

  /* ========== 核心逻辑 ========== */
  function toggleChat() {
    isOpen = !isOpen
    win.classList.toggle('open', isOpen)
    fab.style.display = isOpen ? 'none' : 'flex'
    if (isOpen) {
      unreadCount = 0; unreadBadge.style.display = 'none'
      if (!convId) initChat(); else startPoll()
      setTimeout(function () { inp.focus() }, 200)
    } else {
      stopPoll()
    }
  }

  function initChat() {
    var name = localStorage.getItem(LS_NAME_KEY) || ''
    api('POST', '/init', { visitor_id: visitorId || undefined, name: name || undefined, token: TOKEN || undefined })
      .then(function (d) {
        if (d.code !== 0) return
        visitorId = d.data.visitor_id
        visitorToken = d.data.visitor_token || ''
        convId = d.data.conversation_id
        localStorage.setItem(LS_KEY, visitorId)
        localStorage.setItem(LS_TOKEN_KEY, visitorToken)

        body.innerHTML = ''
        renderWelcome()

        var msgs = d.data.messages || []
        msgs.forEach(function (m) { appendMsg(m) })
        if (msgs.length) lastMsgId = msgs[msgs.length - 1].id
        scrollDown()
        startPoll()
      })
      .catch(function () {
        body.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">连接失败，请稍后重试</div>'
      })
  }

  function renderWelcome() {
    var html = '<div class="gw-welcome"><div class="gw-w-icon"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg></div><p>' + esc(cfg.welcomeText || '您好！有什么可以帮您？') + '</p></div>'
    if (cfg.quickQuestions && cfg.quickQuestions.length) {
      html += '<div class="gw-faq-wrap">'
      cfg.quickQuestions.forEach(function (q, idx) {
        var text = typeof q === 'string' ? q : q.question
        html += '<button type="button" class="gw-faq-btn" data-idx="' + idx + '">' + esc(text) + '</button>'
      })
      html += '</div>'
    }
    body.insertAdjacentHTML('beforeend', html)

    body.querySelectorAll('.gw-faq-btn').forEach(function (btn) {
      btn.onclick = function () {
        var idx = parseInt(btn.getAttribute('data-idx'))
        var q = cfg.quickQuestions[idx]
        var answer = typeof q === 'object' && q.answer ? q.answer : ''
        var question = btn.textContent
        /* 先发送问题 */
        inp.value = question; send()
        /* 如果有预设回复，自动追加回复气泡 */
        if (answer) {
          setTimeout(function () {
            appendMsg({ sender_role: 'admin', type: 'text', content: answer, created_at: new Date().toISOString() })
            body.scrollTop = body.scrollHeight
          }, 400)
        }
      }
    })
  }

  function appendMsg(m) {
    var isUser = m.sender_role === 'user'
    var dir = isUser ? 'gw-out' : 'gw-in'
    var avaLabel = isUser ? '我' : '客'
    var div = document.createElement('div')
    div.className = 'gw-msg ' + dir

    var contentHtml
    if (m.type === 'image') {
      contentHtml = '<div class="gw-bub"><img src="' + esc(m.content) + '" alt="" /></div>'
    } else if (m.type === 'audio') {
      contentHtml = '<div class="gw-bub gw-voice-bub" data-audio="' + esc(m.content) + '"><div class="gw-voice-wave"><i></i><i></i><i></i></div><span class="gw-voice-dur"></span></div>'
    } else {
      contentHtml = '<div class="gw-bub">' + esc(m.content).replace(/\n/g, '<br>') + '</div>'
    }

    div.innerHTML = [
      '<div class="gw-msg-ava">' + avaLabel + '</div>',
      '<div class="gw-msg-body">',
      contentHtml,
      '<span class="gw-bub-ts">' + timeStr(m.created_at) + '</span>',
      '</div>'
    ].join('')

    body.appendChild(div)

    // 图片预览
    if (m.type === 'image') {
      var img = div.querySelector('img')
      if (img) img.onclick = function (ev) {
        ev.stopPropagation()
        preview.querySelector('img').src = m.content
        preview.classList.add('show')
      }
    }

    // 语音播放
    if (m.type === 'audio') {
      var vb = div.querySelector('.gw-voice-bub')
      if (vb) {
        vb.onclick = function () { playVoice(vb, m.content) }
        var tempA = new Audio(m.content)
        var durSpan = vb.querySelector('.gw-voice-dur')
        tempA.onloadedmetadata = function () {
          if (isFinite(tempA.duration)) durSpan.textContent = Math.ceil(tempA.duration) + "''"
        }
      }
    }
  }

  function scrollDown() {
    setTimeout(function () { body.scrollTop = body.scrollHeight }, 60)
  }

  function send() {
    var text = inp.value.trim()
    if (!text || !convId) return
    inp.value = ''

    // 乐观渲染
    appendMsg({ sender_role: 'user', type: 'text', content: text, created_at: new Date().toISOString() })
    scrollDown()

    api('POST', '/send', { visitor_id: visitorId, visitor_token: visitorToken, type: 'text', content: text })
      .then(function (d) {
        if (d.code === 0 && d.data && d.data.id) lastMsgId = Math.max(lastMsgId, d.data.id)
      })
      .catch(function () {})
  }

  function onFilePick(e) {
    var file = e.target.files && e.target.files[0]
    if (!file || !file.type.startsWith('image/')) return
    e.target.value = ''

    var reader = new FileReader()
    reader.onload = function () {
      var base64 = reader.result
      appendMsg({ sender_role: 'user', type: 'image', content: base64, created_at: new Date().toISOString() })
      scrollDown()

      api('POST', '/send', { visitor_id: visitorId, visitor_token: visitorToken, type: 'image', content: base64 })
        .then(function (d) {
          if (d.code === 0 && d.data && d.data.id) lastMsgId = Math.max(lastMsgId, d.data.id)
        })
        .catch(function () {})
    }
    reader.readAsDataURL(file)
  }

  function poll() {
    if (!convId) return
    api('GET', '/messages?visitor_id=' + encodeURIComponent(visitorId) + '&visitor_token=' + encodeURIComponent(visitorToken) + '&since=' + lastMsgId)
      .then(function (d) {
        if (d.code !== 0) return
        var msgs = (d.data && d.data.messages) || []
        var newAdmin = 0
        msgs.forEach(function (m) {
          if (m.id <= lastMsgId) return
          if (m.sender_role === 'user') { lastMsgId = Math.max(lastMsgId, m.id); return }
          appendMsg(m)
          lastMsgId = Math.max(lastMsgId, m.id)
          newAdmin++
        })
        if (newAdmin > 0) {
          scrollDown()
          if (!isOpen) {
            unreadCount += newAdmin
            unreadBadge.textContent = unreadCount > 99 ? '99+' : unreadCount
            unreadBadge.style.display = 'flex'
          }
        }
      })
      .catch(function () {})
  }

  function startPoll() { stopPoll(); pollTimer = setInterval(poll, POLL) }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

  /* ========== 启动：加载配置 ========== */
  api('GET', '/config')
    .then(function (d) {
      if (d.code === 0 && d.data) {
        cfg.welcomeText = d.data.welcomeText || ''
        cfg.quickQuestions = d.data.quickQuestions || []
      }
    })
    .catch(function () {})
})()
