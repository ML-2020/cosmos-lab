// All the words of the interface.  Strings between the display markers are set in the embedded display face
// (tools/make_fonts.py subsets it to exactly those characters), so keep display copy inside the block.

/*display:start*/
export const BRAND = '宇宙观实验室';
export const HERO = {
  title: '宇宙观实验室',
  line1: '同一个夜晚，四种宇宙。',
  line2: '站进去，看它们各自预言的星空，再和真实的天空比一比。',
  start: '从掌心开始',
  ground: '直接站到地面',
  caption: '选一个假说',
};
export const SCALE_CAPTION = {
  palm: '在手掌之上被凝视的银河',
  ground: '渺小之人身处地球之上仰望无限的宇宙',
};
export const MODEL_TEXT = {
  flat: {
    name: '地平说', tag: '圆盘 · 冰墙 · 穹顶',
    gist: '大地是一块平的圆盘：北极在圆心，南极是环绕边缘的冰墙；头顶扣着一个穹顶，日月星辰都挂在里面。',
    claims: [
      '纬度越低，离圆心越远；南极不是一个点，而是一圈冰墙。',
      '日、月、五星和恒星在穹顶下绕北极转圈，各自挂在不同的高度。',
      '天体的升起和落下来自“透视”：离得足够远，就沉入地平线。这一条可以在参数里关掉。',
    ],
    watch: '把观测地换成悉尼或开普敦：北极星还在天上吗？',
  },
  globe: {
    name: '巨球论', tag: '浑天 · 两球宇宙',
    gist: '大地是居中的巨球，外面还有一层大得多的天球，每天绕轴转一圈；日月五星各在自己的球壳上。',
    claims: [
      '大地是球，天也是球；天球带着所有星星每天转一圈。',
      '太阳、月亮和五颗行星沿黄道带，各自在不同的球壳上缓缓移动。',
      '站在地面上，北极星的高度恰好等于你的纬度。',
    ],
    watch: '拉近到地面再拉远：同一片星空，只是你的位置变了。',
  },
  ptolemy: {
    name: '地心说', tag: '本轮 · 均轮 · 偏心匀速点',
    gist: '地球静止居中，七层天球一层套一层；行星沿着本轮转，本轮的圆心又沿着均轮转。',
    claims: [
      '月、水星、金星、太阳、火星、木星、土星、恒星，由近到远，层层嵌套。',
      '均轮是偏心的，圆心之外还有一个“匀速点”，行星相对它才是匀速转动。',
      '逆行不是错觉：行星正走过本轮靠近地球的一侧。',
    ],
    watch: '打开“行星轨迹”看火星的逆行圈，再留意月亮的大小怎么变。',
  },
  helio: {
    name: '日心说', tag: '太阳居中 · 地球自转公转',
    gist: '太阳在中心；地球是第三颗行星，每天自转一圈，每年绕太阳一圈，地轴始终指向同一个方向。',
    claims: [
      '季节来自地轴 23.4° 的倾斜，不来自离太阳的远近。',
      '行星逆行，是地球超过外侧行星（或被内侧行星超过）时视线的回摆。',
      '星星太远，站在地面上看，星空和平常一样。',
    ],
    watch: '看那条从地球射向火星的视线：它回摆的那几个月，火星在天上倒着走。',
  },
};
export const FLIP = {
  head: '你一直都在里面。',
  flat: '头顶是穹顶，脚下是圆盘，你站在它们之间。',
  globe: '脚下一颗巨球，头顶一层天球，你站在两者之间。',
  ptolemy: '七重天球在转动，你静止在最里面。',
  helio: '你被一颗自转的行星带着，绕着太阳飞。',
};
/*display:end*/

export const UI = {
  claims: '它的说法',
  watch: '值得看的',
  params: '参数',
  compare: '模型预言 vs 现实',
  compareHint: '现实 = 此刻此地真实的天文位置',
  moreBodies: '行星',
  mine: '模型',
  real: '现实',
  match: '一致',
  altUnit: '高度',
  nowBtn: '现在', bestBtn: '最佳时间',
  play: '播放', pause: '暂停', reverse: '倒放',
  photo: '摄影师', layers: '图层', shot: '截图', hideUi: '隐藏界面', showUi: '显示界面', fullscreen: '全屏',
  observer: '观测者',
  hand: '掌上', stand: '地面',
  focus: '视点',
};

export const SPEEDS = [
  { label: '1×', rate: 1 },
  { label: '1 分/秒', rate: 60 },
  { label: '10 分/秒', rate: 600 },
  { label: '1 时/秒', rate: 3600 },
  { label: '1 天/秒', rate: 86400 },
  { label: '1 月/秒', rate: 2629800 },
  { label: '1 年/秒', rate: 31557600 },
];

// elev: height of the site above sea level, metres (it changes how much air is above the telescope).
export const PLACES = [
  { name: '上海', lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai', elev: 4 },
  { name: '北京', lat: 39.9042, lon: 116.4074, tz: 'Asia/Shanghai', elev: 44 },
  { name: '拉萨', lat: 29.6500, lon: 91.1000, tz: 'Asia/Shanghai', elev: 3650 },
  { name: '漠河', lat: 53.4850, lon: 122.3370, tz: 'Asia/Shanghai', elev: 440 },
  { name: '三亚', lat: 18.2528, lon: 109.5119, tz: 'Asia/Shanghai', elev: 10 },
  { name: '东京', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo', elev: 40 },
  { name: '特罗姆瑟', lat: 69.6492, lon: 18.9553, tz: 'Europe/Oslo', elev: 10 },
  { name: '冒纳凯阿', lat: 19.8207, lon: -155.4681, tz: 'Pacific/Honolulu', elev: 4205 },
  { name: '基多', lat: -0.1807, lon: -78.4678, tz: 'America/Guayaquil', elev: 2850 },
  { name: '阿塔卡马', lat: -24.6272, lon: -70.4040, tz: 'America/Santiago', elev: 2400 },
  { name: '悉尼', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney', elev: 58 },
  { name: '开普敦', lat: -33.9249, lon: 18.4241, tz: 'Africa/Johannesburg', elev: 25 },
  { name: '北极点', lat: 89.9, lon: 0, tz: 'UTC', elev: 0 },
  { name: '南极点', lat: -89.9, lon: 0, tz: 'UTC', elev: 2835 },
];

// height above the ground the observer can be lifted to (metres)
export const HEIGHTS = [
  { m: 0, name: '站在地上', hint: '眼睛离地 1.7 米' },
  { m: 30, name: '楼顶', hint: '30 米' },
  { m: 500, name: '山顶', hint: '500 米' },
  { m: 3000, name: '热气球', hint: '3 千米' },
  { m: 11000, name: '客机', hint: '11 千米' },
];

// distances along the scale ruler that get a name (metres)
export const LANDMARKS = [
  { m: 1.7, name: '人' }, { m: 8.8e3, name: '珠峰' }, { m: 1e5, name: '太空边缘' }, { m: 4e5, name: '空间站' },
  { m: 3.84e8, name: '月球' }, { m: 1.496e11, name: '日地' },
];

// What each cosmology has to say about the magnetic poles.  `st` = { dipN, dipS, geoN, geoS } (degrees), `x` = live numbers.
const f1 = (v) => Math.round(v).toLocaleString('en-US');
const latS = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;
const lonS = (v) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;
export const MAG_COMMON = '罗盘的指北端被地磁的“北”吸引，所以地理北方的那个磁极，按磁体的叫法其实是 S 极；“磁北”只是方向的名字。';
export const MAG_TEXT = {
  flat: (st, x) => `圆盘上，磁北极离圆心（北极）约 ${f1((90 - st.dipN.lat) * 111.19)} km，罗盘指向它；磁南极在圆盘外缘的冰墙脚下（${latS(st.dipS.lat)} ${lonS(st.dipS.lon)}，离圆心约 ${f1((90 - st.dipS.lat) * 111.19)} km），和磁北极隔着整块圆盘。磁力线只能从圆心附近升起、越过穹顶下方、落向外缘——平地说里没有“穿过地球”的磁轴，所以南半球罗盘的倾角也得另找解释。`,
  globe: (st, x) => `大地是球，球心有一根倾斜的磁棒：轴的两端在地面上是 ${latS(st.geoN.lat)} ${lonS(st.geoN.lon)} 与 ${latS(st.geoS.lat)} ${lonS(st.geoS.lon)}（极光椭圆就围绕它们）。罗盘真正指向的“磁倾极”是 ${latS(st.dipN.lat)} ${lonS(st.dipN.lon)} 与 ${latS(st.dipS.lat)} ${lonS(st.dipS.lon)}，两者并不重合，南北磁倾极也不在地球的两个对径点上——地磁场不是完美的磁棒。`,
  ptolemy: (st, x) => `地心说的天球体系里没有磁场的位置。古人只知道磁针会指向一边（中国叫“司南”“指南针”），欧洲人很长时间认为磁针被北极星吸引，直到 1600 年吉尔伯特才指出地球本身就是一块大磁石。这里把现代测得的磁极画在静止居中的球形大地上：磁北极 ${latS(st.dipN.lat)} ${lonS(st.dipN.lon)}，磁南极 ${latS(st.dipS.lat)} ${lonS(st.dipS.lon)}。`,
  helio: (st, x) => `地球是自转的行星，液态外核的流动像发电机一样产生磁场，近似一根倾斜的磁棒；太阳风把它吹成向日面扁、背日面拖着长尾的磁层，极光就是太阳风粒子沿磁力线落进两极的结果。磁北极在漂移：近几年每年移动约 ${f1(x.drift)} km，现在在 ${latS(st.dipN.lat)} ${lonS(st.dipN.lon)}；磁南极 ${latS(st.dipS.lat)} ${lonS(st.dipS.lon)}。`,
};

// ---------------------------------------------------------------- 日月对照 (sheet block)
// x = numbers this place/day gave: maxAlt / realMaxAlt (°), sun / realSun / moon / realMoon (arcmin ranges, already formatted),
// sunRatio / moonRatio / realMoonRatio (largest ÷ smallest apparent diameter), sepS / sepM (largest direction error, °)
export const LUM_INTRO = '四种体系要解释的是同一份天象：日月星辰的方向，几千年来早就记成了历表。所以只要一套体系把方向算对了，你在地面上抬头看到的就和别的体系一样——这不是显示出了问题。下面把各体系对同一天的预言画在一起，曲线分开的地方，才是它们真正能被检验的地方。';
export const LUM_TEXT = {
  flat: (x) => `地平说：太阳和月亮是盘面上空的小光盘，离你的距离随位置变化。它是这四套里唯一在方向上就对不上的：今天太阳最高只到 ${x.maxAlt.toFixed(0)}°，实际是 ${x.realMaxAlt.toFixed(0)}°；` +
    `白天太阳的视直径应在 ${x.sun} 之间变化（${x.sunRatio.toFixed(1)} 倍），实际一整天几乎不变，是 ${x.realSun}。日月方向与实际的最大偏差：太阳 ${x.sepS.toFixed(1)}°，月亮 ${x.sepM.toFixed(1)}°。数值随“参数”里的太阳高度等滑块变化。`,
  globe: (x) => `巨球论（浑天）：大地是静止的球，日月星挂在外面一个巨大的天球上绕转。这里日月的位置直接取自历表，所以方向、大小都和白色的“实际”线重合：太阳视直径恒为 ${x.realSun}，月亮在 ${x.realMoon} 之间变化。从地面看，它和日心说分不出区别，要区分只能靠恒星视差、光行差、傅科摆这类更精细的证据。`,
  ptolemy: (x) => `地心说：用本轮、均轮“算”出日月位置，方向与实际最多差 ${x.sepS.toFixed(2)}°（太阳）和 ${x.sepM.toFixed(2)}°（月亮），肉眼分不出来。分出高下的是距离：这套模型里月亮绕本轮转，视直径应在 ${x.moon} 之间变化（${x.moonRatio.toFixed(2)} 倍），实际只有 ${x.realMoon}（${x.realMoonRatio.toFixed(2)} 倍）。古人没有测量月亮视直径的好办法，这个破绽被注意到已经很晚。`,
  helio: (x) => `日心说：地球自转并绕太阳公转。到了地面，日月的方向只由几何决定，所以和巨球论逐点重合，也和白色的“实际”线重合：太阳视直径恒为 ${x.realSun}，月亮在 ${x.realMoon} 之间变化。“地动”还是“天动”，单看日月的方向毫无区别；能分开它们的是恒星视差、光行差、金星的相位等证据。`,
};
export const LUM_NOTE = '白色宽线是实际天象，由天文历表算出；彩线是各体系对同一时刻的预言，由本站各体系的模型算出，都不是示意图。月亮每天只取它在天上最高的那一刻来比较。';
