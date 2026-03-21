// SightEngine API – image, video, and text moderation
// All detection driven by API response. Config: SIGHTENGINE_API_USER, SIGHTENGINE_API_SECRET, SIGHTENGINE_THRESHOLD (default 0.7)

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER || '1537357512';
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET || '4QMHc6xHWh4cXu25JQg2vuEDa5bWeVH5';
const SIGHTENGINE_THRESHOLD = parseFloat(process.env.SIGHTENGINE_THRESHOLD) || 0.7;
const SIGHTENGINE_TEXT_THRESHOLD = parseFloat(process.env.SIGHTENGINE_TEXT_THRESHOLD) || 0.6;

const SIGHTENGINE_API_URL = 'https://api.sightengine.com/1.0/check.json';
const SIGHTENGINE_VIDEO_SYNC_URL = 'https://api.sightengine.com/1.0/video/check-sync.json';
const SIGHTENGINE_TEXT_API_URL = 'https://api.sightengine.com/1.0/text/check.json';

async function withRetry(fn, label = 'request') {
  try {
    return await fn();
  } catch (err) {
    console.warn(`SightEngine ${label} failed, retrying...`, err?.message);
    return await fn();
  }
}

/**
 * Recursively extract max numeric score from SightEngine API value.
 * Excludes: "none" (safe indicator), "context" (location, not explicitness).
 */
function getScore(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    if ('raw' in value && typeof value.raw === 'number') return value.raw;
    if ('prob' in value && typeof value.prob === 'number') return value.prob;
    let max = 0;
    for (const [k, v] of Object.entries(value)) {
      if (k === 'none') continue;
      if (k === 'context') continue;
      const s = getScore(v);
      if (typeof s === 'number' && s > max) max = s;
    }
    return max;
  }
  return 0;
}

function interpretMediaResult(result, threshold = SIGHTENGINE_THRESHOLD) {
  let flagged = false;
  const reasons = [];
  const skipKeys = ['status', 'request', 'media'];

  for (const key of Object.keys(result)) {
    if (skipKeys.includes(key)) continue;
    const score = getScore(result[key]);
    if (typeof score === 'number' && score > threshold) {
      flagged = true;
      reasons.push(key);
    }
  }

  return { flagged, reason: reasons.length ? reasons.join(', ') : null };
}

function interpretTextResult(result, threshold = SIGHTENGINE_TEXT_THRESHOLD) {
  let flagged = false;
  const reasons = [];
  const skipKeys = ['status', 'request'];

  for (const key of Object.keys(result)) {
    if (skipKeys.includes(key)) continue;
    const data = result[key];
    if (data?.matches && Array.isArray(data.matches) && data.matches.length > 0) {
      flagged = true;
      const matchTexts = data.matches.map((m) => m.match || m.type || key).filter(Boolean);
      reasons.push(`${key}: ${matchTexts.join(', ')}`);
    }
  }

  const mlClasses = result.moderation_classes;
  if (mlClasses && typeof mlClasses === 'object') {
    for (const [cls, score] of Object.entries(mlClasses)) {
      if (typeof score === 'number' && score >= threshold) {
        flagged = true;
        reasons.push(cls);
      }
    }
  }

  return { flagged, reason: reasons.length ? reasons.join('; ') : null };
}

async function callSightEngine(url, formData) {
  formData.append('api_user', SIGHTENGINE_API_USER);
  formData.append('api_secret', SIGHTENGINE_API_SECRET);
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    const errText = await response.text();
    console.error('SightEngine API error:', response.status, response.statusText, errText?.substring(0, 200));
    throw new Error(`SightEngine ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function checkImageModeration(imageBuffer, mimeType = 'image/jpeg') {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const formData = new FormData();
  formData.append('media', new Blob([imageBuffer], { type: mimeType }), `image.${ext}`);
  formData.append('models', 'nudity-2.0,wad,violence,gore-2.0');

  try {
    const result = await withRetry(() => callSightEngine(SIGHTENGINE_API_URL, formData), 'image');
    const { flagged, reason } = interpretMediaResult(result);
    return { flagged, reason, details: { raw: result } };
  } catch (error) {
    console.error('SightEngine image moderation error:', error);
    return { flagged: false, reason: null, details: null };
  }
}

export async function checkVideoModeration(videoBuffer, mimeType = 'video/mp4') {
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mov') ? 'mov' : 'mp4';
  const formData = new FormData();
  formData.append('media', new Blob([videoBuffer], { type: mimeType }), `video.${ext}`);
  formData.append('models', 'nudity-2.0,wad,violence,gore-2.0');

  try {
    const result = await withRetry(() => callSightEngine(SIGHTENGINE_VIDEO_SYNC_URL, formData), 'video');
    const { flagged, reason } = interpretMediaResult(result);
    return { flagged, reason, details: { raw: result } };
  } catch (error) {
    console.error('SightEngine video moderation error:', error);
    return { flagged: false, reason: null, details: null };
  }
}

export async function checkTextContent(textContent) {
  if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
    return { flagged: false, reason: null, details: null };
  }

  const formData = new FormData();
  formData.append('text', textContent);
  formData.append('lang', 'en');
  formData.append('mode', 'rules,ml');
  formData.append('models', 'general,self-harm');
  formData.append('categories', 'profanity,personal,link,drug,weapon,spam,content-trade,money-transaction,extremism,violence,self-harm,medical');

  try {
    const result = await withRetry(() => callSightEngine(SIGHTENGINE_TEXT_API_URL, formData), 'text');
    const { flagged, reason } = interpretTextResult(result);
    return { flagged, reason, details: { raw: result, textLength: textContent.length } };
  } catch (error) {
    console.error('SightEngine text moderation error:', error);
    return { flagged: false, reason: null, details: null };
  }
}
