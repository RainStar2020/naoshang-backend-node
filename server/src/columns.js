/**
 * 专栏（Column）定义 —— 业务可编辑数据
 *
 * 存放位置：`db.columns`（落盘在 data/db.json），业务可直接改这个文件里的专栏与章节，
 * 不需要改代码。首次启动若集合为空，会用本文件的 DEFAULT_COLUMNS 兜底填充。
 *
 * 专栏 id 与激活码种子里的 `NS-COL-0001 → targetType:'column', targetId:'col_1'` 对齐，
 * 也与商城目录里的专栏商品 id 一致（见 catalogDisplay.js），三处必须同名。
 */
const { nodes, heading, para } = require('./richContent');

const DEFAULT_COLUMNS = [
  {
    id: 'col_1',
    title: '专注力特训专栏',
    summary: '21 天专注力提升计划，配套视频与练习，适合在家自主训练。',
    coverUrl: '/static/product/product-cover.jpg',   // 与 src/static/product/product-cover.jpg 一致（勿再写回 .png）
    price: 299,                 // 标价（元）
    fulfillmentType: 'ACTIVATION_CODE',
    requiresMember: false,
    pricePresentation: 'tiered',
    checkoutNotice: '专栏课下单后联系门店获取激活码',
    content: nodes(
      heading('专注力特训专栏'),
      para('这是一套面向 6–12 岁孩子的专注力训练方案，共 4 课，每课 10 分钟左右，含视频与练习。'),
      para('建议每天固定一个时段陪孩子跟练一次，课后记录完成情况，下一课会自动带出上次的进度。')
    ),
    chapters: [
      { id: 'COL1-C1', title: '开篇 · 专注力基线测评', type: 'article', content: nodes(heading('专注力基线测评'), para('先做一次基线测评，了解孩子当前的专注水平，后续对照进步。')) },
      { id: 'COL1-C2', title: '第 1 周 · 呼吸与放松训练', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/col1-c2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/col1-c2.jpg', content: nodes(heading('呼吸与放松训练'), para('每天 5 分钟呼吸训练，帮助快速进入专注状态。')) },
      { id: 'COL1-C3', title: '第 2 周 · 番茄工作法', type: 'article', content: nodes(heading('番茄工作法'), para('用番茄钟把学习任务切小，降低启动阻力。')) },
      { id: 'COL1-C4', title: '第 3 周 · 干扰隔离训练', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/col1-c4.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/col1-c4.jpg', content: nodes(heading('干扰隔离训练'), para('识别并隔离干扰源，打造无干扰学习环境。')) },
    ],
  },
  {
    id: 'col_2',
    title: '记忆大师专栏',
    summary: '从联想记忆到记忆宫殿，系统提升记忆效率。',
    coverUrl: '/static/product/product-cover.jpg',   // 与 src/static/product/product-cover.jpg 一致（勿再写回 .png）
    price: 199,
    fulfillmentType: 'ACTIVATION_CODE',
    requiresMember: false,
    pricePresentation: 'tiered',
    checkoutNotice: '专栏课下单后联系门店获取激活码',
    content: nodes(
      heading('记忆大师专栏'),
      para('共 2 课，聚焦可迁移的记忆方法：先把零散信息用故事串起来，再用空间把故事固定下来。')
    ),
    chapters: [
      { id: 'COL2-C1', title: '联想记忆入门', type: 'article', content: nodes(heading('联想记忆入门'), para('用故事把零散信息串联起来，记得更牢。')) },
      { id: 'COL2-C2', title: '记忆宫殿实战', type: 'video', videoUrl: 'https://cdn.naoshang.example.com/video/col2-c2.mp4', posterUrl: 'https://cdn.naoshang.example.com/poster/col2-c2.jpg', content: nodes(heading('记忆宫殿实战'), para('搭建你的第一座记忆宫殿，存放考试要点。')) },
    ],
  },
];

/** 取专栏定义（db.columns 优先，缺省回落到默认种子） */
function columnById(db, id) {
  const list = (db && Array.isArray(db.columns) && db.columns.length) ? db.columns : DEFAULT_COLUMNS;
  return list.find((c) => c.id === id) || null;
}

/** 取专栏章节（跨专栏查找） */
function columnChapterOf(db, chapterId) {
  const list = (db && Array.isArray(db.columns) && db.columns.length) ? db.columns : DEFAULT_COLUMNS;
  for (const c of list) {
    const ch = (c.chapters || []).find((x) => x.id === chapterId);
    if (ch) return { column: c, chapter: ch };
  }
  return null;
}

/** 专栏列表 */
function columnList(db) {
  const list = (db && Array.isArray(db.columns) && db.columns.length) ? db.columns : DEFAULT_COLUMNS;
  return list;
}

module.exports = { DEFAULT_COLUMNS, columnById, columnChapterOf, columnList };
