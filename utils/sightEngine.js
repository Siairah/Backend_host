// SightEngine API utility for image and text moderation
// Uses Node.js 18+ built-in fetch and FormData (no external deps)

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER || '1537357512';
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET || '4QMHc6xHWh4cXu25JQg2vuEDa5bWeVH5';
const SIGHTENGINE_API_URL = 'https://api.sightengine.com/1.0/check.json';
const SIGHTENGINE_TEXT_API_URL = 'https://api.sightengine.com/1.0/text/check.json';

/** Retry helper - run fn up to 2 times on failure */
async function withRetry(fn, label = 'request') {
  try {
    return await fn();
  } catch (err) {
    console.warn(`SightEngine ${label} failed, retrying...`, err?.message);
    return await fn();
  }
}

/**
 * Check image for inappropriate content using SightEngine (checks twice with retry)
 * @param {Buffer} imageBuffer - Image buffer to check
 * @param {string} mimeType - e.g. 'image/jpeg', 'image/png'
 * @returns {Promise<{flagged: boolean, reason: string, details: object}>}
 */
export async function checkImageModeration(imageBuffer, mimeType = 'image/jpeg') {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const filename = `image.${ext}`;

  const doCheck = async () => {
    const formData = new FormData();
    formData.append('media', new Blob([imageBuffer], { type: mimeType }), filename);
    formData.append('models', 'nudity-2.0,wad,violence,gore-2.0');
    formData.append('api_user', SIGHTENGINE_API_USER);
    formData.append('api_secret', SIGHTENGINE_API_SECRET);

    const response = await fetch(SIGHTENGINE_API_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('SightEngine image API error:', response.status, response.statusText, errText?.substring(0, 200));
      throw new Error(`SightEngine ${response.status}: ${response.statusText}`);
    }

    return response.json();
  };

  try {
    const result = await withRetry(() => doCheck(), 'image check');
    
    // Log the full response for debugging
    console.log('🔍 SightEngine API Response:', JSON.stringify(result, null, 2));
    
    const nudity = result.nudity?.raw || 0;
    const weapon = result.weapon || 0;
    const alcohol = result.alcohol || 0;
    const drugs = result.drugs || 0;
    // Violence: violence.prob or violence.raw
    const violence = result.violence?.prob ?? result.violence?.raw ?? result.violence ?? 0;
    // Gore: gore.prob or gore.raw (gore-2.0 model)
    const gore = result.gore?.prob ?? result.gore?.raw ?? result.gore ?? 0;

    console.log('📊 Detection Scores:', {
      nudity: nudity.toFixed(3),
      weapon: weapon.toFixed(3),
      alcohol: alcohol.toFixed(3),
      drugs: drugs.toFixed(3),
      violence: violence.toFixed(3),
      gore: gore.toFixed(3)
    });

    const THRESHOLD = 0.6;
    let flagged = false;
    let reasons = [];

    if (nudity > THRESHOLD) {
      flagged = true;
      reasons.push('Inappropriate content');
      console.log(`🚩 NUDITY DETECTED! Score: ${nudity.toFixed(3)}`);
    }
    if (weapon > THRESHOLD) {
      flagged = true;
      reasons.push('Weapon content');
      console.log(`🚩 WEAPON DETECTED! Score: ${weapon.toFixed(3)}`);
    }
    if (alcohol > THRESHOLD) {
      flagged = true;
      reasons.push('Alcohol content');
      console.log(`🚩 ALCOHOL DETECTED! Score: ${alcohol.toFixed(3)}`);
    }
    if (drugs > THRESHOLD) {
      flagged = true;
      reasons.push('Drug content');
      console.log(`🚩 DRUGS DETECTED in image! Score: ${drugs.toFixed(3)}`);
    }
    if (violence > THRESHOLD) {
      flagged = true;
      reasons.push('Violence content');
      console.log(`🚩 VIOLENCE DETECTED in image! Score: ${violence.toFixed(3)}`);
    }
    if (gore > THRESHOLD) {
      flagged = true;
      reasons.push('Gore content');
      console.log(`🚩 GORE DETECTED in image! Score: ${gore.toFixed(3)}`);
    }

    return {
      flagged,
      reason: reasons.length > 0 ? reasons.join(', ') : null,
      details: {
        nudity,
        weapon,
        alcohol,
        drugs,
        violence,
        gore,
        raw: result
      }
    };
  } catch (error) {
    console.error('SightEngine moderation error:', error);
    // Fail open - don't block posts if moderation service fails
    return { flagged: false, reason: null, details: null };
  }
}

/**
 * Check text content using SightEngine Text Moderation API (checks twice with retry)
 * Uses BOTH rules (drugs, weapons, etc) AND ML (violence, threats, insults, toxic)
 * @param {string} textContent - Text content to check
 * @returns {Promise<{flagged: boolean, reason: string, details: object}>}
 */
export async function checkTextContent(textContent) {
  if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
    return { flagged: false, reason: null, details: null };
  }

  const doCheck = async () => {
    const formData = new FormData();
    formData.append('text', textContent);
    formData.append('lang', 'en');
    formData.append('mode', 'rules,ml');
    formData.append('models', 'general,self-harm');
    formData.append('categories', 'profanity,personal,link,drug,weapon,spam,content-trade,money-transaction,extremism,violence,self-harm,medical');
    formData.append('api_user', SIGHTENGINE_API_USER);
    formData.append('api_secret', SIGHTENGINE_API_SECRET);

    const response = await fetch(SIGHTENGINE_TEXT_API_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('SightEngine Text API error:', response.status, response.statusText, errText?.substring(0, 200));
      throw new Error(`SightEngine ${response.status}: ${response.statusText}`);
    }

    return response.json();
  };

  try {
    console.log('🔍 Checking text with SightEngine (rules+ml):', textContent.substring(0, 100));
    const result = await withRetry(() => doCheck(), 'text check');
    console.log('🔍 SightEngine Text API Response:', JSON.stringify(result, null, 2));

    let flagged = false;
    const reasons = [];
    const skipKeys = ['status', 'request'];

    // 1) Rule-based: check matches in each category
    for (const key of Object.keys(result)) {
      if (skipKeys.includes(key)) continue;
      const data = result[key];
      if (data?.matches && Array.isArray(data.matches) && data.matches.length > 0) {
        flagged = true;
        const matchTexts = data.matches.map((m) => m.match || m.type || key).filter(Boolean);
        reasons.push(`${key}: ${matchTexts.join(', ')}`);
      }
    }

    // 2) ML model: check moderation_classes scores (violent, toxic, insulting, etc)
    const mlClasses = result.moderation_classes;
    if (mlClasses && typeof mlClasses === 'object') {
      const ML_THRESHOLD = 0.5; // Flag if score >= 0.5
      const mlCheckKeys = ['violent', 'toxic', 'insulting', 'discriminatory', 'sexual', 'self-harm'];
      for (const cls of mlCheckKeys) {
        const score = mlClasses[cls];
        if (typeof score === 'number' && score >= ML_THRESHOLD) {
          flagged = true;
          reasons.push(cls);  // Simple: no score in notification
          console.log(`🚩 ML FLAGGED: ${cls} score=${score.toFixed(3)}`);
        }
      }
    }

    return {
      flagged,
      reason: reasons.length > 0 ? reasons.join('; ') : null,
      details: { raw: result, textLength: textContent.length }
    };
  } catch (error) {
    console.error('SightEngine text moderation error:', error);
    return { flagged: false, reason: null, details: null };
  }
}

