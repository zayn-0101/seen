// 视频笔记的内容形态：内容类型、类型模板、质量分。
// 纯函数、无 IO，供 analyze / render / note-check / index 共用，避免三处各写一套上限。

export const CONTENT_TYPES = Object.freeze([
  { id: 'tutorial', label: '教程' },
  { id: 'opinion', label: '观点' },
  { id: 'science', label: '科普' },
  { id: 'review', label: '评测' },
  { id: 'interview', label: '访谈' },
  { id: 'documentary', label: '纪录' },
  { id: 'course', label: '课程' },
  { id: 'other', label: '其他' }
]);

export const TEMPLATE_LIMITS = Object.freeze({
  prerequisites: 4,
  steps: 8,
  arguments: 5,
  doubts: 3,
  mechanisms: 4,
  misconceptions: 3,
  comparisons: 6,
  people: 6,
  timeline: 8,
  exercises: 4,
  quotes: 3,
  terms: 8,
  resources: 6
});

const CONTENT_TYPE_ALIASES = new Map([
  ['tutorial', 'tutorial'],
  ['guide', 'tutorial'],
  ['howto', 'tutorial'],
  ['how-to', 'tutorial'],
  ['教程', 'tutorial'],
  ['教学', 'tutorial'],
  ['入门', 'tutorial'],
  ['操作指南', 'tutorial'],
  ['opinion', 'opinion'],
  ['commentary', 'opinion'],
  ['观点', 'opinion'],
  ['评论', 'opinion'],
  ['时评', 'opinion'],
  ['杂谈', 'opinion'],
  ['science', 'science'],
  ['explainer', 'science'],
  ['科普', 'science'],
  ['知识', 'science'],
  ['review', 'review'],
  ['评测', 'review'],
  ['测评', 'review'],
  ['盘点', 'review'],
  ['interview', 'interview'],
  ['podcast', 'interview'],
  ['访谈', 'interview'],
  ['播客', 'interview'],
  ['对话', 'interview'],
  ['documentary', 'documentary'],
  ['纪录', 'documentary'],
  ['纪录片', 'documentary'],
  ['纪实', 'documentary'],
  ['course', 'course'],
  ['lecture', 'course'],
  ['课程', 'course'],
  ['课堂', 'course'],
  ['系列课', 'course']
]);

const TEMPLATE_KEYS_BY_TYPE = Object.freeze({
  tutorial: ['prerequisites', 'steps'],
  course: ['prerequisites', 'steps', 'exercises'],
  opinion: ['arguments', 'doubts'],
  science: ['mechanisms', 'misconceptions'],
  review: ['comparisons'],
  interview: ['people'],
  documentary: ['timeline'],
  other: []
});

const HUMAN_SUBTITLE_SOURCES = new Set(['up-subtitle', 'youtube-subtitle', 'user-subtitle', 'manual']);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function stringList(value, limit, maxLength = 80) {
  const out = [];
  for (const item of asArray(value)) {
    const text = cleanText(typeof item === 'object' && item !== null ? item.text ?? item.content : item, maxLength);
    if (!text) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function stepList(value) {
  const out = [];
  for (const item of asArray(value)) {
    let text = '';
    let time = null;
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      text = item.text ?? item.content ?? item.point ?? item.title ?? '';
      time = cleanTime(item.time ?? item.start ?? item.at);
    }
    text = cleanText(text, 120);
    if (!text) continue;
    const step = { text };
    if (time !== null) step.time = time;
    out.push(step);
    if (out.length >= TEMPLATE_LIMITS.steps) break;
  }
  return out;
}

function objectList(value, limit, fields) {
  const out = [];
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      const first = fields[0];
      const entry = {};
      entry[first] = cleanText(item, 120);
      if (Object.values(entry).some(Boolean)) out.push(entry);
      if (out.length >= limit) break;
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const entry = {};
    for (const [key, max] of fields) {
      const text = cleanText(item[key], max);
      if (text) entry[key] = text;
    }
    if (Object.keys(entry).length === 0) continue;
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

function timelineList(value) {
  const out = [];
  for (const item of asArray(value)) {
    if (typeof item === 'string') {
      const text = cleanText(item, 120);
      if (!text) continue;
      out.push({ label: '', event: text });
      if (out.length >= TEMPLATE_LIMITS.timeline) break;
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const event = cleanText(item.event ?? item.text ?? item.description, 160);
    if (!event) continue;
    const entry = { label: cleanText(item.label ?? item.timeLabel ?? item.date, 40), event };
    const time = cleanTime(item.time);
    if (time !== null) entry.time = time;
    out.push(entry);
    if (out.length >= TEMPLATE_LIMITS.timeline) break;
  }
  return out;
}

export function normalizeContentType(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'other';
  const lower = raw.toLowerCase();
  if (CONTENT_TYPES.some((item) => item.id === lower)) return lower;
  return CONTENT_TYPE_ALIASES.get(raw) || CONTENT_TYPE_ALIASES.get(lower) || 'other';
}

export function normalizeKeyPointPoints(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    let text = '';
    let time = null;
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      text = item.text ?? item.content ?? item.point ?? item.title ?? '';
      time = cleanTime(item.time ?? item.start ?? item.at);
    }
    text = cleanText(text, 120);
    if (!text) continue;
    const point = { text };
    if (time !== null) point.time = time;
    out.push(point);
    if (out.length >= 5) break;
  }
  return out;
}

export function normalizeTemplate(value, contentType) {
  const type = normalizeContentType(contentType);
  const source = value && typeof value === 'object' ? value : {};
  const template = {};
  for (const key of TEMPLATE_KEYS_BY_TYPE[type]) {
    if (key === 'steps') template.steps = stepList(source.steps);
    else if (key === 'arguments') template.arguments = objectList(source.arguments, TEMPLATE_LIMITS.arguments, [['claim', 80], ['basis', 120]]);
    else if (key === 'mechanisms') template.mechanisms = objectList(source.mechanisms, TEMPLATE_LIMITS.mechanisms, [['point', 80], ['evidence', 120]]);
    else if (key === 'comparisons') template.comparisons = objectList(source.comparisons, TEMPLATE_LIMITS.comparisons, [['item', 60], ['verdict', 80], ['basis', 120]]);
    else if (key === 'people') template.people = objectList(source.people, TEMPLATE_LIMITS.people, [['name', 40], ['view', 160]]);
    else if (key === 'timeline') template.timeline = timelineList(source.timeline);
    else if (key === 'prerequisites') template.prerequisites = stringList(source.prerequisites, TEMPLATE_LIMITS.prerequisites);
    else if (key === 'doubts') template.doubts = stringList(source.doubts, TEMPLATE_LIMITS.doubts);
    else if (key === 'misconceptions') template.misconceptions = stringList(source.misconceptions, TEMPLATE_LIMITS.misconceptions);
    else if (key === 'exercises') template.exercises = stringList(source.exercises, TEMPLATE_LIMITS.exercises);
  }
  return template;
}

export function normalizeQuotes(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    let text = '';
    let time = null;
    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      text = item.text ?? item.quote ?? item.content ?? '';
      time = cleanTime(item.time ?? item.start ?? item.at);
    }
    text = cleanText(text, 80);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const quote = { text };
    if (time !== null) quote.time = time;
    out.push(quote);
    if (out.length >= TEMPLATE_LIMITS.quotes) break;
  }
  return out;
}

export function normalizeTerms(value) {
  const out = [];
  const seen = new Set();
  for (const item of asArray(value)) {
    if (!item || typeof item !== 'object') continue;
    const name = cleanText(item.name ?? item.term, 80);
    const definition = cleanText(item.definition ?? item.brief ?? item.desc, 80);
    const nameLength = [...name].length;
    if (nameLength < 2 || nameLength > 12 || !definition || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, definition });
    if (out.length >= TEMPLATE_LIMITS.terms) break;
  }
  return out;
}

export function normalizeResources(value) {
  const out = [];
  for (const item of asArray(value)) {
    if (!item || typeof item !== 'object') continue;
    const name = cleanText(item.name ?? item.title, 40);
    if (!name) continue;
    const resource = { name };
    const note = cleanText(item.note ?? item.desc ?? item.description, 80);
    if (note) resource.note = note;
    out.push(resource);
    if (out.length >= TEMPLATE_LIMITS.resources) break;
  }
  return out;
}

export function templateSections(contentType) {
  const type = normalizeContentType(contentType);
  return TEMPLATE_KEYS_BY_TYPE[type].map((key) => {
    if (key === 'prerequisites') return { key, title: '前置条件', kind: 'list' };
    if (key === 'steps') return { key, title: type === 'course' ? '课程脉络' : '操作步骤', kind: 'ordered' };
    if (key === 'exercises') return { key, title: '练习', kind: 'list' };
    if (key === 'arguments') return { key, title: '论证结构', kind: 'table' };
    if (key === 'doubts') return { key, title: '可质疑之处', kind: 'list' };
    if (key === 'mechanisms') return { key, title: '机制与证据', kind: 'table' };
    if (key === 'misconceptions') return { key, title: '常见误解', kind: 'list' };
    if (key === 'comparisons') return { key, title: '对比', kind: 'table' };
    if (key === 'people') return { key, title: '人物观点', kind: 'table' };
    if (key === 'timeline') return { key, title: '事件时间线', kind: 'table' };
    return null;
  }).filter(Boolean);
}

export function scoreNoteQuality({ contentQuality, transcriptSource, transcriptLength, keyPointCount, conceptCount } = {}) {
  if (contentQuality !== 'full') return 1;
  let score = 3;
  const length = Number(transcriptLength);
  const source = String(transcriptSource ?? '');
  if (HUMAN_SUBTITLE_SOURCES.has(source) || (Number.isFinite(length) && length >= 8000)) score += 1;
  const points = Number(keyPointCount);
  const concepts = Number(conceptCount);
  if (Number.isFinite(points) && points >= 6 && Number.isFinite(concepts) && concepts >= 4) score += 1;
  if (Number.isFinite(points) && points < 3) score -= 1;
  return Math.max(1, Math.min(5, score));
}

export function normalizeQuality(value, fallback = 1) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= 5) return number;
  const base = Number(fallback);
  if (Number.isInteger(base) && base >= 1 && base <= 5) return base;
  return 1;
}
