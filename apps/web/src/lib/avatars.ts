// 由 tools/scripts/build_avatar.py 生成的贴片坐标（百分比，相对 16:9 底图）。形象为 AI 生成的虚构人物。
export type AvatarId = 'teacher' | 'buyer'
export const AVATARS = {
 "teacher": {
  "name": "陈老师",
  "title": "国际贸易实务 · 数字人教师",
  "voice": "男声 · 云扬",
  "mouth": { "src": "laoshi-mouth.png", "left": 30.087, "top": 30.729, "width": 39.898, "height": 30.99 },
  "eyes": { "src": "laoshi-eyes.png", "left": 39.026, "top": 20.573, "width": 19.477, "height": 16.146 },
  "image": "laoshi.jpg"
 },
 "buyer": {
  "name": "Markus Weber",
  "title": "模拟买家 · 德国进口商采购经理",
  "voice": "男声 · 云健",
  "mouth": {
   "src": "buyer-mouth.png",
   "left": 32.631,
   "top": 37.5,
   "width": 31.395,
   "height": 23.177
  },
  "eyes": {
   "src": "buyer-eyes.png",
   "left": 42.369,
   "top": 29.167,
   "width": 15.698,
   "height": 9.115
  },
  "image": "buyer.jpg"
 }
} as const
