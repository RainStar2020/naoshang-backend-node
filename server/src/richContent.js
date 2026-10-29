/**
 * 富文本节点（CMS 发布的净化节点 JSON，绝不下发可执行 HTML）
 *
 * ⚠️ 2026-10-27 修正节点 schema
 *   前端 `src/features/content/rich-content.js` 的 normalizeContent 只认两种节点：
 *     ① {name: <白名单标签>, children: [...]}   ② {type:'text', text}
 *   原后端产出 {type:'paragraph', text} / {type:'heading', text}，name 不在白名单 → 被整段丢弃，
 *   导致协议 / 课程 / 商品正文在小程序里渲染为空白。现统一改为前端契约格式。
 */
const NODES_ALLOWED_TAGS = new Set(['p', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'img']);

/** 组装富文本根节点 */
const nodes = (...items) => ({ format: 'nodes', version: 1, nodes: items });
/** 段落 */
const para = (text) => ({ name: 'p', children: [{ type: 'text', text: String(text) }] });
/** 小节标题 */
const heading = (text) => ({ name: 'h2', children: [{ type: 'text', text: String(text) }] });
/** 无序列表 */
const list = (items) => ({ name: 'ul', children: items.map((t) => ({ name: 'li', children: [{ type: 'text', text: String(t) }] })) });
/** 图片（仅允许 https 媒体地址，与前端 isMediaUrl 对齐） */
const image = (src, alt) => ({ name: 'img', attrs: { src, alt: String(alt || '') }, children: [] });

/** 自检：确保产出的节点能通过前端的 normalizeContent 规则（避免再出现"整段被丢弃"） */
function assertRenderable(content) {
  if (!content || content.version !== 1 || content.format !== 'nodes' || !Array.isArray(content.nodes)) {
    throw new Error('富文本根结构非法：需要 {version:1, format:"nodes", nodes:[]}');
  }
  for (const n of content.nodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') continue;
    if (!NODES_ALLOWED_TAGS.has(n.name)) throw new Error(`富文本节点标签不在白名单：${n.name}`);
  }
  return content;
}

module.exports = { nodes, para, heading, list, image, assertRenderable, NODES_ALLOWED_TAGS };
