import type { DialogScript } from '../dialog/DialogRuntime';

const ioriIntro: DialogScript = {
  id: 'iori-intro',
  npcId: 'iori',
  priority: 50,
  when: { questStatus: { id: 'main-wake', status: 'active' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'イオリ',
      text: '目を覚ましたか。ここは始まりの里。あなたが長い眠りから戻るのを、待っていた。',
      next: 'b',
    },
    {
      id: 'b',
      speaker: 'イオリ',
      text: '大地の三つの塔が眠ったままだ。塔を目覚めさせれば、この地の霧が晴れる。',
      next: 'c',
    },
    {
      id: 'c',
      speaker: 'イオリ',
      text: '急な坂は、壁に向かって登れる。塔の階段を上り、頂上の端末に触れるのだ。',
      effects: [
        { type: 'flag', id: 'met-elder' },
        { type: 'completeQuest', id: 'main-wake' },
      ],
    },
  ],
};

const ioriTowers: DialogScript = {
  id: 'iori-towers',
  npcId: 'iori',
  priority: 40,
  when: { questStatus: { id: 'main-towers', status: 'active' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'イオリ',
      text: '塔はまだ三つとも眠っている。ミニマップの光を目印に進むとよい。',
    },
  ],
};

const ioriTowersReady: DialogScript = {
  id: 'iori-towers-ready',
  npcId: 'iori',
  priority: 60,
  when: { questStatus: { id: 'main-towers', status: 'readyToTurnIn' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'イオリ',
      text: '塔が三つとも目を覚ましたか。霧が晴れ、高地の魔物の居場所が見えるようになった。',
      next: 'b',
    },
    {
      id: 'b',
      speaker: 'イオリ',
      text: '闘技場へ向かい、あの者を倒してくれ。大振りは避け、飛びかかりは着地の瞬間に離れるのだ。',
      effects: [{ type: 'turnIn', id: 'main-towers' }],
    },
  ],
};

const ioriReport: DialogScript = {
  id: 'iori-report',
  npcId: 'iori',
  priority: 70,
  when: { questStatus: { id: 'main-report', status: 'active' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'イオリ',
      text: '戻ったか。風が軽くなった。あなたの旅が、この大地を取り戻した。',
      next: 'b',
    },
    {
      id: 'b',
      speaker: 'イオリ',
      text: 'The End ― 冒険はつづく。里の者たちは、まだ頼みごとを抱えている。',
      effects: [
        { type: 'completeQuest', id: 'main-report' },
        { type: 'flag', id: 'ending' },
      ],
    },
  ],
};

const ioriIdle: DialogScript = {
  id: 'iori-idle',
  npcId: 'iori',
  priority: 0,
  start: 'a',
  nodes: [{ id: 'a', speaker: 'イオリ', text: '焦ることはない。この大地は、あなたの歩幅でいい。' }],
};

const miraOffer: DialogScript = {
  id: 'mira-offer',
  npcId: 'mira',
  priority: 20,
  when: { questStatus: { id: 'side-herbs', status: 'available' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'ミラ',
      text: '旅人さん、草原の薬草を 5 つ分けてもらえない？　お礼に、息が長く続くようにしてあげる。',
      choices: [
        { label: '引き受ける', next: 'yes' },
        { label: 'いまはいい', next: 'no' },
      ],
    },
    {
      id: 'yes',
      speaker: 'ミラ',
      text: 'ありがとう。緑の葉を探してきて。',
      effects: [{ type: 'startQuest', id: 'side-herbs' }],
    },
    { id: 'no', speaker: 'ミラ', text: 'そう。気が向いたら、また声をかけて。' },
  ],
};

const miraActive: DialogScript = {
  id: 'mira-active',
  npcId: 'mira',
  priority: 30,
  when: { questStatus: { id: 'side-herbs', status: 'active' } },
  start: 'a',
  nodes: [{ id: 'a', speaker: 'ミラ', text: '薬草はまだ足りないみたい。草原を歩いてみて。' }],
};

const miraReady: DialogScript = {
  id: 'mira-ready',
  npcId: 'mira',
  priority: 40,
  when: { questStatus: { id: 'side-herbs', status: 'readyToTurnIn' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'ミラ',
      text: 'いい香り。これで薬が作れる。あなたのスタミナも、少し広がったはず。',
      effects: [{ type: 'turnIn', id: 'side-herbs' }],
    },
  ],
};

const miraIdle: DialogScript = {
  id: 'mira-idle',
  npcId: 'mira',
  priority: 0,
  start: 'a',
  nodes: [{ id: 'a', speaker: 'ミラ', text: '里の外は広いけど、迷ったら塔の光を見上げて。' }],
};

const soraOffer: DialogScript = {
  id: 'sora-offer',
  npcId: 'sora',
  priority: 20,
  when: { questStatus: { id: 'side-camp', status: 'available' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'ソラ',
      text: '里の外に魔物の焚き火がある。一箇所でも静かにしてもらえたら、剣を渡す。',
      choices: [
        { label: '引き受ける', next: 'yes' },
        { label: 'またあとで', next: 'no' },
      ],
    },
    {
      id: 'yes',
      speaker: 'ソラ',
      text: '赤い点のあたりだ。全部倒すと、キャンプは鎮まる。',
      effects: [{ type: 'startQuest', id: 'side-camp' }],
    },
    { id: 'no', speaker: 'ソラ', text: 'わかった。無理はするな。' },
  ],
};

const soraActive: DialogScript = {
  id: 'sora-active',
  npcId: 'sora',
  priority: 30,
  when: { questStatus: { id: 'side-camp', status: 'active' } },
  start: 'a',
  nodes: [
    { id: 'a', speaker: 'ソラ', text: 'まだ焚き火の音がする。キャンプの敵を全員倒してくれ。' },
  ],
};

const soraReady: DialogScript = {
  id: 'sora-ready',
  npcId: 'sora',
  priority: 40,
  when: { questStatus: { id: 'side-camp', status: 'readyToTurnIn' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'ソラ',
      text: '静かになったな。約束の剣だ。大事に使ってくれ。',
      effects: [{ type: 'turnIn', id: 'side-camp' }],
    },
  ],
};

const soraIdle: DialogScript = {
  id: 'sora-idle',
  npcId: 'sora',
  priority: 0,
  start: 'a',
  nodes: [{ id: 'a', speaker: 'ソラ', text: '里の中までは、魔物も入ってこない。' }],
};

const rinOffer: DialogScript = {
  id: 'rin-offer',
  npcId: 'rin',
  priority: 20,
  when: { questStatus: { id: 'side-apples', status: 'available' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'リン',
      text: 'リンゴを 3 つ、落としちゃった。見つけたら、返してほしいな。',
      choices: [
        { label: '探してあげる', next: 'yes' },
        { label: '今は忙しい', next: 'no' },
      ],
    },
    {
      id: 'yes',
      speaker: 'リン',
      text: 'やった。赤い実だよ。',
      effects: [{ type: 'startQuest', id: 'side-apples' }],
    },
    { id: 'no', speaker: 'リン', text: 'うん……。' },
  ],
};

const rinActive: DialogScript = {
  id: 'rin-active',
  npcId: 'rin',
  priority: 30,
  when: { questStatus: { id: 'side-apples', status: 'active' } },
  start: 'a',
  nodes: [{ id: 'a', speaker: 'リン', text: 'リンゴ、まだ 3 つないみたい。' }],
};

const rinReady: DialogScript = {
  id: 'rin-ready',
  npcId: 'rin',
  priority: 40,
  when: { questStatus: { id: 'side-apples', status: 'readyToTurnIn' } },
  start: 'a',
  nodes: [
    {
      id: 'a',
      speaker: 'リン',
      text: 'これだ！　ありがとう。元気、分けたげる。',
      effects: [{ type: 'turnIn', id: 'side-apples' }],
    },
  ],
};

const rinIdle: DialogScript = {
  id: 'rin-idle',
  npcId: 'rin',
  priority: 0,
  start: 'a',
  nodes: [{ id: 'a', speaker: 'リン', text: '塔、きらきらしてるね。' }],
};

export const INTRO_SCRIPT: DialogScript = {
  id: 'intro',
  npcId: 'narrator',
  priority: 0,
  start: 'a',
  nodes: [
    { id: 'a', speaker: '', text: '……ここは、どこだ。', next: 'b' },
    {
      id: 'b',
      speaker: '',
      text: '風と、草の匂い。誰かが、こちらを見ている。',
      effects: [{ type: 'flag', id: 'intro-seen' }],
    },
  ],
};

export const DIALOG_SCRIPTS: readonly DialogScript[] = [
  ioriIntro,
  ioriTowersReady,
  ioriTowers,
  ioriReport,
  ioriIdle,
  miraReady,
  miraActive,
  miraOffer,
  miraIdle,
  soraReady,
  soraActive,
  soraOffer,
  soraIdle,
  rinReady,
  rinActive,
  rinOffer,
  rinIdle,
];
