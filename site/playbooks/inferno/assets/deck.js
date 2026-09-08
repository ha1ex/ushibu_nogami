const slides = [...document.querySelectorAll('.slide')];
const picker = document.querySelector('#slide-picker');
const currentNode = document.querySelector('[data-current]');
const totalNode = document.querySelector('[data-total]');
const progress = document.querySelector('.progress-fill');
const timerNode = document.querySelector('[data-timer]');
const timerButton = document.querySelector('#timer-button');
let current = 0;
let timerSeconds = 0;
let timerId = null;

const tacticalVideos = {
  6:[{id:'Q2ZbsYahBYU',start:0,range:'0:00–0:27',topic:'Распределение пяти ролей T'}],
  7:[{id:'Q2ZbsYahBYU',start:27,range:'0:27–2:37',topic:'Контроль банана парой'}],
  8:[{id:'Q2ZbsYahBYU',start:395,range:'6:35–8:12',topic:'Роль игрока мида'},{id:'Q2ZbsYahBYU',start:492,range:'8:12–9:12',topic:'Контроль апартаментов'}],
  9:[{id:'Q2ZbsYahBYU',start:718,range:'11:58–13:06',topic:'Решение после занятия карты'}],
  10:[{id:'B31jBh84Lak',start:0,range:'0:00–0:31',topic:'Схема выхода A через шорт'}],
  11:[{id:'B31jBh84Lak',start:31,range:'0:31–2:47',topic:'Роли и очередность выхода A'}],
  12:[{id:'R4T4uVoD9wo',start:848,range:'14:08–15:08',topic:'Что должен пережить постплент A'}],
  13:[{id:'GGnIlSezLi0',start:0,range:'0:00–0:23',topic:'Схема полного выхода B'}],
  14:[{id:'GGnIlSezLi0',start:23,range:'0:23–2:28',topic:'Роли и очередность выхода B'}],
  15:[{id:'R4T4uVoD9wo',start:848,range:'14:08–15:08',topic:'Давление ретейка на постплент B'}],
  16:[{id:'I0PmXuD-KGU',start:0,range:'0:00–0:15',topic:'Базовое распределение CT'}],
  17:[{id:'I0PmXuD-KGU',start:15,range:'0:15–1:15',topic:'CT-контроль банана'}],
  18:[{id:'I0PmXuD-KGU',start:335,range:'5:35–6:35',topic:'Базовая защита A'}],
  19:[{id:'R4T4uVoD9wo',start:848,range:'14:08–15:08',topic:'Ошибка гранаты в ретейке A'}],
  20:[{id:'R4T4uVoD9wo',start:848,range:'14:08–15:08',topic:'Синхрон гранаты и входа в ретейк B'}]
};

function videoRefMarkup(refs = []) {
  return refs.length ? `<div class="video-refs" aria-label="Видеоразбор этого блока">${refs.map((ref) => `<a class="video-ref" href="https://www.youtube.com/watch?v=${ref.id}&amp;t=${ref.start}s" target="_blank" rel="noopener noreferrer"><span class="video-ref__label">▶ Видео</span><span class="video-ref__range">${ref.range}</span><span class="video-ref__topic">${ref.topic}</span></a>`).join('')}</div>` : '';
}

Object.entries(tacticalVideos).forEach(([slideIndex, refs]) => {
  const header = slides[Number(slideIndex) - 1]?.querySelector('.slide-head');
  const indexNode = header?.querySelector('.slide-index');
  if (!header || !indexNode) return;
  const aside = document.createElement('div');
  aside.className = 'slide-head__aside';
  aside.innerHTML = videoRefMarkup(refs);
  indexNode.replaceWith(aside);
  aside.append(indexNode);
});

const pad = (value) => String(value).padStart(2, '0');

function goTo(index, replace = false) {
  current = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === current;
    slide.classList.toggle('is-active', active);
    slide.setAttribute('aria-hidden', String(!active));
  });
  currentNode.textContent = pad(current + 1);
  picker.value = String(current);
  const ratio = ((current + 1) / slides.length) * 100;
  progress.style.width = `${ratio}%`;
  progress.dataset.progress = String(ratio);
  document.querySelector('#previous-button').disabled = current === 0;
  document.querySelector('#next-button').disabled = current === slides.length - 1;
  const url = new URL(location.href);
  url.searchParams.set('slide', String(current + 1));
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function changeTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    timerButton.textContent = 'Старт таймера';
    timerButton.setAttribute('aria-pressed', 'false');
    return;
  }
  timerId = setInterval(() => {
    timerSeconds += 1;
    timerNode.textContent = `${pad(Math.floor(timerSeconds / 60))}:${pad(timerSeconds % 60)}`;
  }, 1000);
  timerButton.textContent = 'Пауза таймера';
  timerButton.setAttribute('aria-pressed', 'true');
}

slides.forEach((slide, index) => {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = `${pad(index + 1)} · ${slide.dataset.slideTitle}`;
  picker.append(option);
});
totalNode.textContent = pad(slides.length);
picker.addEventListener('change', () => goTo(Number(picker.value)));
document.querySelector('#previous-button').addEventListener('click', () => goTo(current - 1));
document.querySelector('#next-button').addEventListener('click', () => goTo(current + 1));
timerButton.addEventListener('click', changeTimer);
document.addEventListener('keydown', (event) => {
  if (event.target.matches('select')) return;
  if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); goTo(current + 1); }
  if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); goTo(current - 1); }
  if (event.key === 'Home') { event.preventDefault(); goTo(0); }
  if (event.key === 'End') { event.preventDefault(); goTo(slides.length - 1); }
});
window.addEventListener('popstate', () => {
  const requested = Number(new URL(location.href).searchParams.get('slide') || 1);
  goTo(Number.isInteger(requested) && requested >= 1 && requested <= slides.length ? requested - 1 : 0, true);
});

const callouts = [
  ['Респаун T',82,74,820,820,130],['Рампа T',75,82,690,885,120],['Нижний мид',66,77,650,735,140],
  ['Второй мид',56,78,450,840,140],['Апартаменты',53,69,420,700,160],['Бойлер',59,72,610,670,105],
  ['Верхний мид',56,66,515,560,155],['Шорт',51,39,370,385,105],['Лонг / арка',75,39,580,365,150],
  ['Библиотека',81,32,805,285,145],['Яма',42,21,340,180,85],['Балкон',52.5,14.5,500,95,110],
  ['Плент A',47,21,455,235,115],['Банан',39,50,245,485,105],['Брёвна',28,61,120,585,115],
  ['Мешки',44,43,415,445,100],['Плент B',7,71,40,655,115],['Гробы',18,70,175,730,100],
  ['Церковь',23,68,220,640,125],['КТ',92,38,845,405,85]
];

const pinSets = {
  't-default': [
    ['D4ba · первый банан',29,61,125,535],['L!S · поддержка банана',39,51,120,620],
    ['d0lfero · снайпер мид',66,76,650,825],['middle · второй мид',56,78,400,835],['Reconnecting · апартаменты',53,67,430,610]
  ],
  'a-exec': [
    ['D4ba · первый шорт',50,40,285,350],['L!S · размен шорт',55,40,305,430],
    ['middle · апартаменты',55,29,435,245],['Reconnecting · балкон',52,20,570,135],['d0lfero · арка / фланг',75,39,690,500]
  ],
  'b-exec': [
    ['D4ba · первый банан',22,64,40,675],['middle · размен',28,61,55,570],
    ['L!S · бомба',39,51,290,650],['Reconnecting · гранаты',44,46,310,390],['d0lfero · фланг',55,66,575,625]
  ],
  'ct-default': [
    ['D4ba · якорь B',12,69,90,620],['middle · банан',29,61,235,465],
    ['d0lfero · снайпер арка',75,39,680,330],['Reconnecting · яма',42,21,260,155],['L!S · шорт / ротация',51,39,440,455]
  ]
};

const retakePinSets = {
  'retake-a': [
    ['L!S · вход с шорта',52,39,350,350],['middle · смок мото',60,33,530,230],
    ['d0lfero · библиотека',81,32,700,260],['Reconnecting · лонг',75,39,700,430],['D4ba · ротация КТ',92,38,820,340]
  ],
  'retake-b': [
    ['D4ba · вход КТ',92,38,820,350],['Reconnecting · поддержка КТ',82,45,700,500],
    ['d0lfero · банан',39,50,315,455],['middle · церковь',23,68,250,620],['L!S · гробы',18,70,150,730]
  ]
};

const routes = {
  't-default':'M820 740 C730 700 620 705 560 590 M820 740 C650 760 510 760 520 680 M820 740 C650 680 430 590 320 500',
  'a-exec':'M560 590 C545 500 520 455 490 390 C475 320 470 270 470 215 M530 680 C535 560 535 430 530 280',
  'b-exec':'M560 590 C450 550 360 500 320 440 C260 420 175 510 95 690',
  'ct-default':'M920 380 C780 390 700 390 600 390 M920 380 C730 460 500 500 300 505 M920 380 C650 530 320 610 110 690',
  'retake-a':'M920 380 C780 350 675 320 560 260 M690 390 C620 330 550 260 470 215',
  'retake-b':'M920 380 C700 470 430 610 110 690 M230 680 C180 680 140 680 95 700'
};

function calloutMarkup() {
  return callouts.map(([label,x,y,lx,ly,width]) => {
    const ax=x*10, ay=y*10, height=28;
    const edge=plaqueEdge(ax,ay,lx,ly,width,height);
    return `<g class="map-label" data-x="${x}" data-y="${y}"><circle class="anchor-dot" cx="${ax}" cy="${ay}" r="8"/><path class="leader-line" d="M ${ax} ${ay} L ${edge.x} ${edge.y}"/><rect class="label-bg" x="${lx}" y="${ly}" width="${width}" height="${height}" rx="3"/><text class="label-text" x="${lx+8}" y="${ly+height/2}">${label}</text></g>`;
  }).join('');
}

function plaqueEdge(ax,ay,x,y,width,height) {
  const cx=x+width/2, cy=y+height/2, dx=cx-ax, dy=cy-ay;
  const tx=dx===0?-Infinity:Math.min((x-ax)/dx,(x+width-ax)/dx);
  const ty=dy===0?-Infinity:Math.min((y-ay)/dy,(y+height-ay)/dy);
  const entry=Math.max(tx,ty);
  return {x:ax+dx*entry,y:ay+dy*entry};
}

function pinMarkup(type) {
  const team = type === 'ct-default' ? 'ct' : 't';
  return (pinSets[type] || []).map(([label,x,y,lx,ly]) => {
    const ax=x*10, ay=y*10, width=Math.max(150,label.length*9.5);
    const edge=plaqueEdge(ax,ay,lx,ly,width,28);
    return `<g class="role-pin ${team}" data-x="${x}" data-y="${y}"><circle class="pin-dot" cx="${ax}" cy="${ay}" r="13"/><line class="pin-line" x1="${ax}" y1="${ay}" x2="${edge.x}" y2="${edge.y}"/><rect class="pin-bg" x="${lx}" y="${ly}" width="${width}" height="28" rx="3"/><text class="pin-label" x="${lx+8}" y="${ly+14}">${label}</text></g>`;
  }).join('');
}

function retakeMarkup(type) {
  return (retakePinSets[type] || []).map(([label,x,y,lx,ly]) => {
    const ax=x*10, ay=y*10, width=Math.max(150,label.length*9.5);
    const edge=plaqueEdge(ax,ay,lx,ly,width,28);
    return `<g class="retake-pin ct" data-x="${x}" data-y="${y}"><circle class="pin-dot" cx="${ax}" cy="${ay}" r="13"/><line class="pin-line" x1="${ax}" y1="${ay}" x2="${edge.x}" y2="${edge.y}"/><rect class="pin-bg" x="${lx}" y="${ly}" width="${width}" height="28" rx="3"/><text class="pin-label" x="${lx+8}" y="${ly+14}">${label}</text></g>`;
  }).join('');
}

document.querySelectorAll('[data-map]').forEach((node) => {
  const type = node.dataset.map;
  node.innerHTML = `<div class="radar-frame"><img src="assets/inferno-radar.webp" alt="Радар Inferno, источник CSNADES.gg"><svg viewBox="0 0 1000 1000" aria-label="Тактическая схема Inferno"><defs><marker id="arrow-t" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#ff6a35"/></marker><marker id="arrow-ct" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#59b9ff"/></marker></defs>${type==='callouts'?calloutMarkup():`<path class="map-route ${type.startsWith('retake')||type==='ct-default'?'ct':''}" d="${routes[type]||''}"/>${pinMarkup(type)}${retakeMarkup(type)}`}</svg></div><div class="radar-caption"><span>Якорь = точная точка на радаре</span><span>${type==='callouts'?'русские командные коллы':'маршрут — намерение, не траектория прицела'}</span></div>`;
});

const requested = Number(new URL(location.href).searchParams.get('slide') || 1);
goTo(Number.isInteger(requested) && requested >= 1 && requested <= slides.length ? requested - 1 : 0, true);

window.infernoDeck = { goTo };
