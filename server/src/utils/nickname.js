/**
 * 随机昵称生成器：固定格式「xxx鱼」
 * 例如：奔跑的鱼 / 爱笑的鱼 / 星星鱼
 */
const PREFIX_A = [
  '奔跑的', '爱笑的', '闪闪的', '快乐的', '安静的', '勇敢的', '好奇的', '温柔的',
  '发呆的', '冲浪的', '摘星的', '追风的', '爱吃的', '瞌睡的', '跳跳的', '悄悄的',
];
const PREFIX_B = [
  '小', '大', '元气', '星星', '月亮', '海盐', '柠檬', '奶糖',
];

function randomNickname() {
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  // 两种风格随机：形容词式（奔跑的鱼）/ 前缀式（元气鱼）
  return Math.random() < 0.5 ? `${rand(PREFIX_A)}鱼` : `${rand(PREFIX_B)}${rand(PREFIX_A).replace('的', '')}鱼`;
}

module.exports = { randomNickname };
