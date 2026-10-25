// A structural walkthrough, deliberately separate from persisted/live evidence.
const icon = name => `<svg class="icon" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
const question = '故宫博物院周一闭馆的规则是什么？法定节假日和特殊安排有哪些例外？';

export function evidenceBoard() {
  return `<button class="evidence-board" data-demo="open" aria-label="打开三轮追查交互演示">
    <span class="board-grid" aria-hidden="true"></span><span class="board-header"><span><i></i> OPEN CASE / 001</span><span>流程示意</span></span>
    <span class="board-orbit" aria-hidden="true"></span><span class="board-connector" aria-hidden="true"></span>
    <span class="evidence-slip slip-question"><span class="slip-label">THE CLAIM / 待核实说法</span><strong>「每逢周一闭馆，<br>节假日也一样？」</strong><span class="slip-tag">一句「听说」，开启一次追查</span><span class="paper-pin"></span></span>
    <span class="evidence-slip slip-source"><span class="slip-label">FOLLOW THE SOURCE</span><span class="board-source-icon">${icon('globe')}</span><strong>回到原始出处</strong><span>核对时间 · 规则 · 例外</span><span class="source-paper-lines"><i></i><i></i><i></i></span></span>
    <span class="board-seal">有据<br><small>可循</small></span><span class="board-note">先找出处，再下判断。</span>
    <span class="board-footer"><span><i>01</i> 线索 <b>···</b> <i>02</i> 核对 <b>···</b> <i>03</i> 档案</span><span class="board-open">${icon('arrow-up-right')}</span></span>
  </button>`;
}

const stages = [
  { label: '拆解问题', title: '先把「都一样」拆开问。', copy: '绝对化的说法，往往省略了时间与条件。三轮追查先找原始规则，再补查例外，最后核对已经找到的来源。', body: `<div class="demo-claim"><span>待查问题</span><h3>每逢周一闭馆，节假日也一样吗？</h3></div><div class="demo-queries"><article><b>01</b><div><h3>查原始规则</h3><p>故宫博物院 · 开放时间 · 周一闭馆</p></div></article><article><b>02</b><div><h3>追问适用条件</h3><p>法定节假日 · 特别开放安排 · 例外</p></div></article><article><b>03</b><div><h3>回到来源复核</h3><p>根据前两轮命中的网站，调整检索范围</p></div></article></div>` },
  { label: '对照来源', title: '找到网页，只是调查的开始。', copy: '每条真实结果会留下原始摘要和链接。打开原文，检查日期和上下文，再标注它支持什么、质疑什么。', body: `<div class="demo-source"><span class="slip-label">建议优先核对的公开入口 · 尚未检索</span><h3>${icon('globe')}故宫博物院官方网站</h3><a href="https://www.dpm.org.cn/" target="_blank" rel="noopener noreferrer">dpm.org.cn ${icon('arrow-up-right')}</a><p>查找参观须知及对应日期的开放公告。这里是资料入口，不是本次搜索结果。</p></div><div class="demo-annotations"><span>＋ 支持说法</span><span>− 质疑说法</span><span>↗ 补充背景</span></div><p class="demo-small-note">正式调查中可收藏来源、查看跨轮检索记录，并在「来源对照」中分组检查证据。</p>` },
  { label: '留下档案', title: '让下一个人，也能复核你的判断。', copy: '记录人工结论，保留无法确定的部分，再把来源与检索过程一起导出。无需把一段 AI 回答当作最终事实。', body: `<div class="demo-report"><div class="demo-report-top"><span>YOUJU / 调查报告结构预览</span>${icon('file')}</div><h3>周一闭馆规则与节假日例外</h3><div><span>当前判断</span><b>待检索 · 暂不下结论</b></div><div><span>证据清单</span><b>原始摘要 + 可打开的来源</b></div><div><span>检索轨迹</span><b>每轮检索词、范围与请求编号</b></div><div><span>还需确认</span><b>具体出行日期及对应公告</b></div><footer>正式调查后可导出 Markdown，或打印为 PDF。</footer></div>` }
];

export function initWalkthrough(onTry) {
  const dialog = document.createElement('dialog');
  dialog.className = 'walkthrough-dialog'; dialog.id = 'walkthrough-dialog';
  dialog.setAttribute('aria-labelledby', 'walkthrough-title');
  document.body.append(dialog);
  let step = 0, opener;
  const render = (focusTab = false) => {
    const stage = stages[step];
    dialog.innerHTML = `<header class="walkthrough-header"><div><span class="eyebrow">一份调查，如何发生</span><h2 id="walkthrough-title">从一句听说，到有据可循。</h2></div><button class="icon-button" data-demo="close" aria-label="关闭演示">${icon('close')}</button></header><div class="demo-notice">交互流程演示 · 未调用搜索服务 · 不计入真实调查档案</div><div class="demo-tabs" role="tablist" aria-label="演示步骤">${stages.map((s, i) => `<button id="demo-tab-${i}" role="tab" aria-selected="${i === step}" aria-controls="demo-stage" tabindex="${i === step ? 0 : -1}" data-demo="step" data-step="${i}"><span>0${i + 1}</span>${s.label}</button>`).join('')}</div><div class="demo-stage" id="demo-stage" role="tabpanel" aria-labelledby="demo-tab-${step}" tabindex="0"><div class="demo-stage-intro"><span>0${step + 1} / 03</span><h3>${stage.title}</h3><p>${stage.copy}</p></div><div class="demo-stage-body">${stage.body}</div></div><footer class="walkthrough-footer"><span>真实结论，始终来自真实检索与复核。</span>${step < 2 ? `<button class="primary-button" data-demo="next">下一步${icon('arrow')}</button>` : `<button class="primary-button" data-demo="try">用这个问题开始调查${icon('arrow')}</button>`}</footer>`;
    if (focusTab) dialog.querySelector(`[data-step="${step}"]`).focus();
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-demo]'); if (!button) return;
    if (button.dataset.demo === 'open') { opener = button; step = 0; render(); dialog.showModal(); }
    if (button.dataset.demo === 'close') dialog.close();
    if (button.dataset.demo === 'step') { step = Number(button.dataset.step); render(true); }
    if (button.dataset.demo === 'next') { step = Math.min(step + 1, 2); render(true); }
    if (button.dataset.demo === 'try') { dialog.close(); onTry(question); }
  });
  dialog.addEventListener('keydown', event => {
    if (!event.target.matches('[role="tab"]')) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); step = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (step + (event.key === 'ArrowRight' ? 1 : 2)) % 3; render(true);
  });
  dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
}
