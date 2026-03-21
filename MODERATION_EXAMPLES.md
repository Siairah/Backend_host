# Content Moderation – What SightEngine API Detects

This document lists **examples of content the SightEngine API detects**. These come from SightEngine’s models, not hardcoded rules.

Set `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET` in your backend `.env`. Get keys at [dashboard.sightengine.com](https://dashboard.sightengine.com).

---

## Images & Videos (models: nudity-2.0, wad, violence, gore-2.0)

### Nudity & adult content
- Sexual activity, sexual display, erotica
- Very suggestive, suggestive, mildly suggestive
- Exposed genitals, breasts, buttocks
- Sex toys, lingerie, provocative poses
- Bikinis, swimwear in suggestive contexts

### Weapons
- Firearms, rifles, handguns
- Knives, daggers, axes
- Chainsaws, cleavers, hatchets
- Threatening poses with weapons

### Alcohol
- Wine, beer, champagne in bottles or glasses
- Cocktails, cocktail shakers

### Drugs
- Cannabis leaf, buds, joints
- Bongs, glass pipes
- Syringes, pills, pill bottles
- Snorting scenes

### Violence
- Physical violence and threats
- Aiming weapons, aggressive poses

### Gore
- Blood, wounds, corpses
- Graphic or horrific imagery

---

## Text (rules + ML models: general, self-harm)

### Rule-based categories
- **Profanity** – swear words, slurs
- **Drugs** – drug names, dealing references
- **Weapons** – weapon-related terms, threats
- **Violence** – violent language
- **Self-harm** – self-harm references
- **Spam** – promotional spam patterns
- **Extremism** – extremist content
- **Medical** – unsafe medical claims

### ML-based scores
- **Violent** – threatening or violent tone
- **Toxic** – hostile or abusive
- **Insulting** – personal attacks
- **Discriminatory** – hate speech
- **Sexual** – sexual content
- **Self-harm** – self-harm or suicide risk

---

## Example text that may be flagged (from API, not hardcoded)

SightEngine will flag text that matches its rules or gets high ML scores. Examples of **types** of content that can be flagged:

| Category | Example content type |
|----------|----------------------|
| Threats | “I will hurt you”, “I’ll kill you” |
| Drugs | “weed for sale”, “cocaine deal” |
| Profanity | Slurs, severe profanity |
| Violence | Graphic violence descriptions |
| Self-harm | References to suicide or self-injury |
| Spam | “Click here to win”, suspicious links |

**Note:** This list is illustrative. Actual detection depends on SightEngine’s API. Your app does not store or hardcode these phrases; the API decides what to flag.

---

## Thresholds (optional env vars)

- `SIGHTENGINE_THRESHOLD` – image/video score (default 0.6)
- `SIGHTENGINE_TEXT_THRESHOLD` – text ML score (default 0.5)
