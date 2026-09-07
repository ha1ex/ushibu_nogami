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
  ['Второй мид',53,78,450,840,140],['Апартаменты',53,69,435,650,160],['Бойлер',59,72,610,670,105],
  ['Верхний мид',56,58,515,560,155],['Шорт',51,39,430,385,105],['Лонг / арка',70,39,690,365,150],
  ['Библиотека',81,32,805,285,145],['Яма',42,21,340,180,85],['Балкон',53,14,500,95,110],
  ['Плент A',47,21,455,235,115],['Банан',36,48,290,500,105],['Брёвна',27,58,205,585,115],
  ['Мешки',42,42,415,445,100],['Плент B',7,71,40,655,115],['Гробы',18,70,175,730,100],
  ['Церковь',23,68,220,640,125],['КТ',92,38,845,405,85]
];

const pinSets = {
  't-default': [
    ['D4ba · первый банан',33,51,125,535],['L!S · поддержка банана',29,58,120,620],
    ['d0lfero · снайпер мид',66,76,650,825],['middle · второй мид',53,77,400,835],['Reconnecting · апартаменты',53,67,430,610]
  ],
  'a-exec': [
    ['D4ba · первый шорт',50,40,285,350],['L!S · размен шорт',55,43,305,430],
    ['middle · апартаменты',54,29,435,245],['Reconnecting · балкон',52,20,570,135],['d0lfero · арка / фланг',68,42,690,500]
  ],
  'b-exec': [
    ['D4ba · первый банан',31,51,105,520],['middle · размен',28,57,55,570],
    ['L!S · бомба',22,62,290,650],['Reconnecting · гранаты',35,46,310,390],['d0lfero · фланг',55,59,575,625]
  ],
  'ct-default': [
    ['D4ba · якорь B',11,69,90,620],['middle · банан',29,51,235,465],
    ['d0lfero · снайпер арка',69,39,680,330],['Reconnecting · яма',42,21,260,155],['L!S · шорт / ротация',51,39,440,455]
  ]
};

const retakePinSets = {
  'retake-a': [
    ['L!S · вход с шорта',52,39,350,350],['middle · смок мото',60,33,530,230],
    ['d0lfero · библиотека',81,32,700,260],['Reconnecting · лонг',70,39,700,430],['D4ba · ротация КТ',92,38,820,340]
  ],
  'retake-b': [
    ['D4ba · вход КТ',92,38,820,350],['Reconnecting · поддержка КТ',82,45,700,500],
    ['d0lfero · банан',36,48,315,455],['middle · церковь',23,68,250,620],['L!S · гробы',18,70,150,730]
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
    return `<g class="map-label" data-x="${x}" data-y="${y}"><circle class="anchor-dot" cx="${ax}" cy="${ay}" r="8"/><path class="leader-line" d="M ${ax} ${ay} L ${lx} ${ly+height/2}"/><rect class="label-bg" x="${lx}" y="${ly}" width="${width}" height="${height}" rx="3"/><text class="label-text" x="${lx+8}" y="${ly+height/2}">${label}</text></g>`;
  }).join('');
}

function pinMarkup(type) {
  const team = type === 'ct-default' ? 'ct' : 't';
  return (pinSets[type] || []).map(([label,x,y,lx,ly]) => {
    const ax=x*10, ay=y*10, width=Math.max(150,label.length*9.5);
    return `<g class="role-pin ${team}" data-x="${x}" data-y="${y}"><circle class="pin-dot" cx="${ax}" cy="${ay}" r="13"/><line class="pin-line" x1="${ax}" y1="${ay}" x2="${lx}" y2="${ly+14}"/><rect class="pin-bg" x="${lx}" y="${ly}" width="${width}" height="28" rx="3"/><text class="pin-label" x="${lx+8}" y="${ly+14}">${label}</text></g>`;
  }).join('');
}

function retakeMarkup(type) {
  return (retakePinSets[type] || []).map(([label,x,y,lx,ly]) => {
    const ax=x*10, ay=y*10, width=Math.max(150,label.length*9.5);
    return `<g class="retake-pin ct" data-x="${x}" data-y="${y}"><circle class="pin-dot" cx="${ax}" cy="${ay}" r="13"/><line class="pin-line" x1="${ax}" y1="${ay}" x2="${lx}" y2="${ly+14}"/><rect class="pin-bg" x="${lx}" y="${ly}" width="${width}" height="28" rx="3"/><text class="pin-label" x="${lx+8}" y="${ly+14}">${label}</text></g>`;
  }).join('');
}

document.querySelectorAll('[data-map]').forEach((node) => {
  const type = node.dataset.map;
  node.innerHTML = `<div class="radar-frame"><img src="assets/inferno-radar.webp" alt="Радар Inferno, источник CSNADES.gg"><svg viewBox="0 0 1000 1000" aria-label="Тактическая схема Inferno"><defs><marker id="arrow-t" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#ff6a35"/></marker><marker id="arrow-ct" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="#59b9ff"/></marker></defs>${type==='callouts'?calloutMarkup():`<path class="map-route ${type.startsWith('retake')||type==='ct-default'?'ct':''}" d="${routes[type]||''}"/>${pinMarkup(type)}${retakeMarkup(type)}`}</svg></div><div class="radar-caption"><span>Якорь = точная точка на радаре</span><span>${type==='callouts'?'русские командные коллы':'маршрут — намерение, не траектория прицела'}</span></div>`;
});

const requested = Number(new URL(location.href).searchParams.get('slide') || 1);
goTo(Number.isInteger(requested) && requested >= 1 && requested <= slides.length ? requested - 1 : 0, true);

window.infernoDeck = { goTo };
