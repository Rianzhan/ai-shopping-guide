/* Temporary demo adapter. Replace this file with a Coze Chat SDK adapter mounted at #coze-agent-container.
   External example buttons send a "chengchu:ask" CustomEvent with detail.question to the host. */
(() => {
  const host = document.getElementById('coze-agent-container');
  if (!host) return;

  host.innerHTML = `
    <div class="chat" aria-label="澄初导购对话">
      <div class="chat-header"><div><strong>澄初 AI 金牌导购</strong><small>从你现在最在意的问题开始</small></div></div>
      <div class="chat-messages" aria-live="polite" aria-relevant="additions">
        <div class="message agent">你好。想找哪一类产品？也可以先说预算或香味偏好，我们慢慢聊。</div>
      </div>
      <div class="chat-start"><p>试着从一句话开始</p><div class="quick-questions">
        <button class="chip" type="button" data-demo-question="想找一支洗完不容易紧绷的洁面。">想找温和的洁面</button>
        <button class="chip" type="button" data-demo-question="预算 200，而且我不喜欢香味。">预算 200，不喜欢香味</button>
        <button class="chip" type="button" data-demo-question="最近皮肤有点刺痛，不知道该不该买精华。">皮肤有点刺痛</button>
      </div></div>
      <form class="chat-form"><label for="chat-input">向导购提问</label><input id="chat-input" name="question" type="text" maxlength="180" autocomplete="off" placeholder="写下一个想法，慢慢聊"><button type="submit">发送</button></form>
    </div>`;

  const messages = host.querySelector('.chat-messages');
  const input = host.querySelector('#chat-input');

  function reply(question) {
    const q = question.replace(/\s+/g, '');
    if (/刺痛|不舒服|红肿|过敏|灼热|疼|破皮/.test(q)) {
      return '我无法根据这段描述判断不适的原因，也不适合在此时推荐新产品。可以先暂停尝试新产品；如果不适持续或加重，请咨询皮肤科医生。';
    }
    if (/补差价|差价|退款|售后|赠品|促销|库存|小样/.test(q)) {
      return '目前的品牌资料没有说明这项政策或库存信息。我不能承诺补差价、赠品或小样，建议以门店或正式系统信息为准。';
    }
    if (/200|预算/.test(q) && /无香|香味|香精/.test(q)) {
      return '可以先看看「云感氨基酸舒润洁面乳」：目前资料写明无香型、低泡，示例价 ¥169。其他产品的价格和香味资料还不完整，我先不替你凑一套。';
    }
    if (/无香|香味|香精|干皮|偏干/.test(q)) {
      return '如果你不喜欢香味，可以先看资料注明无香型、低泡的「云感氨基酸舒润洁面乳」。其他产品的香味信息不够完整，我暂时不作判断。';
    }
    if (/洁面|洗面奶|洗脸|控油|紧绷/.test(q)) {
      return '你可以先了解「云感氨基酸舒润洁面乳」：资料注明它是低泡、无香型。至于洗后的实际肤感，每个人可能不同，我不会保证一定不紧绷。';
    }
    if (/预算|搭配|多少钱|价格/.test(q)) {
      return '目前只有「云感氨基酸舒润洁面乳」给出了示例价 ¥169，其余价格还没有可靠资料，暂时不能准确给你配出预算内的一套。你更想先解决清洁还是保湿？';
    }
    if (/出差|旅行|随行|分装/.test(q)) {
      return '可以先看看「随行旅行分装瓶礼盒」。目前资料没有写清容量和内容物，我先不猜测；出行前请确认具体规格。';
    }
    if (/保湿|精华/.test(q)) {
      return '可以先告诉我你现在的护理步骤和最在意的肤感，再决定是否需要增加产品。当前资料还不足以判断保湿乳和精华哪一个更适合你。';
    }
    return '我收到了。当前可用的产品资料还不够完整，不能可靠地回答这一点。你可以先说想看洁面、保湿、精华还是随行产品，或者告诉我预算与香味偏好。';
  }

  function addMessage(kind, text) {
    const message = document.createElement('div');
    message.className = `message ${kind}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function ask(text) {
    const question = String(text || '').trim();
    if (!question) return;
    addMessage('user', question);
    addMessage('agent', reply(question));
    input.value = '';
  }

  host.querySelector('.chat-form').addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
  });
  host.querySelectorAll('[data-demo-question]').forEach(button => {
    button.addEventListener('click', () => ask(button.dataset.demoQuestion));
  });
  host.addEventListener('chengchu:ask', event => ask(event.detail?.question));
})();
