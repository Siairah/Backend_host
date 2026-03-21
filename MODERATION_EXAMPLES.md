# Content Moderation – What SightEngine API Detects

Content types the SightEngine API detects. Set `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` in `.env`.

## Images & Videos (nudity-2.0, wad, violence, gore-2.0)

- **Nudity** – sexual activity, suggestive content, etc.
- **Weapons** – firearms, knives
- **Alcohol** – wine, beer, cocktails
- **Drugs** – cannabis, pills, syringes
- **Violence** – physical violence, threats
- **Gore** – blood, graphic imagery

## Text (rules + ML)

- **Rules**: profanity, drugs, weapons, violence, self-harm, spam, extremism
- **ML**: violent, toxic, insulting, discriminatory, sexual, self-harm

## Env (optional)

- `SIGHTENGINE_THRESHOLD=0.7` – image/video
- `SIGHTENGINE_TEXT_THRESHOLD=0.6` – text
