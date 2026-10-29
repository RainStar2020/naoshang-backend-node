/**
 * GET /api/profile/options  注册第二页（个人形象）可选项配置
 * 头像/装扮目前为占位数据（emoji + key），接 3D 形象/第三方服务后替换为真实素材 URL
 */
const express = require('express');

const router = express.Router();

const GRADES = [
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '初一', '初二', '初三', '高一', '高二', '高三',
];

/** 头像库：key + emoji 占位（后续换 3D 头像 URL） */
const AVATARS = {
  male: [
    { key: 'boy-sport',   label: '运动少年', emoji: '👦' },
    { key: 'boy-cool',    label: '酷酷少年', emoji: '🧑' },
    { key: 'boy-study',   label: '学霸少年', emoji: '👨‍🎓' },
    { key: 'boy-smile',   label: '爱笑少年', emoji: '😀' },
  ],
  female: [
    { key: 'girl-sport',  label: '元气少女', emoji: '👧' },
    { key: 'girl-sweet',  label: '甜美少女', emoji: '👩' },
    { key: 'girl-study',  label: '学霸少女', emoji: '👩‍🎓' },
    { key: 'girl-star',   label: '闪闪少女', emoji: '😊' },
  ],
};

/** 装扮库：与性别强绑定（男只能选男装，女只能选女装） */
const OUTFITS = {
  male: [
    { key: 'm-sport',  label: '篮球达人', emoji: '🏀' },
    { key: 'm-campus', label: '校园风',   emoji: '🎒' },
    { key: 'm-street', label: '街头潮男', emoji: '🧢' },
    { key: 'm-future', label: '未来战士', emoji: '🤖' },
  ],
  female: [
    { key: 'f-dress',  label: '甜美裙装', emoji: '👗' },
    { key: 'f-sport',  label: '运动少女', emoji: '🎾' },
    { key: 'f-campus', label: '学院风',   emoji: '🎀' },
    { key: 'f-magic',  label: '魔法少女', emoji: '🪄' },
  ],
};

router.get('/options', (req, res) => {
  res.json({
    ok: true,
    grades: GRADES,
    defaultGrade: '三年级',
    avatars: AVATARS,
    outfits: OUTFITS,
  });
});

module.exports = { router, GRADES, AVATARS, OUTFITS };
