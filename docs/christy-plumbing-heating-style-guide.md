# Christy Plumbing & Heating Website Style Guide

**Status:** Proposed design direction  
**Prepared:** 31 July 2026  
**Basis:** Review of the current Christy Plumbing & Heating website, its public logo, service offering, company story and trust messaging.

---

## 1. Design objective

The website should present Christy Plumbing & Heating as:

- established and dependable;
- technically competent without feeling corporate or impersonal;
- local, family-run and approachable;
- capable of handling both urgent domestic work and larger planned projects;
- straightforward about pricing, availability and next steps.

The overall impression should be **calm, capable and trustworthy**. It should not look like a generic trades directory, a discount-led lead-generation site or an overly polished national utility company.

The design should modernise the existing brand while keeping the logo recognisable and prominent.

---

## 2. Existing brand cues

The current logo contains two useful visual ideas:

1. **“CHRISTY” is set in a large, traditional serif style.**  
   This gives the brand a sense of history, permanence and family identity.

2. **“Plumbing & Heating” is set in a lighter modern sans-serif.**  
   This makes the service description feel practical and contemporary.

The logo is primarily royal blue and white. The dominant blue sampled from the current raster logo is approximately:

```text
#00309D
```

This should remain the main brand colour.

> The logo should always be used as supplied artwork. Do not recreate it using live text or substitute typefaces.

---

## 3. Core visual direction

Use a **traditional-meets-modern** design system:

- restrained serif type for important headings;
- clean sans-serif type for navigation, body copy and controls;
- strong blue blocks for recognition and authority;
- generous white space to keep pages calm and readable;
- real photographs of engineers, vans, installations and completed work;
- simple line icons rather than cartoon illustrations;
- subtle borders and shadows rather than heavy gradients or glossy effects.

The site should feel designed around a real local business, not assembled from a generic plumbing template.

---

## 4. Colour palette

### Primary palette

| Token | Colour | Intended use |
|---|---:|---|
| `brand-blue` | `#00309D` | Logo alignment, primary buttons, key headings, links and navigation accents |
| `brand-blue-dark` | `#002477` | Hover states, dark panels and stronger text-on-light emphasis |
| `brand-blue-deep` | `#071B3A` | Footer, hero overlays and high-contrast sections |
| `brand-blue-pale` | `#EAF0FC` | Service-card backgrounds, highlighted information and alternating sections |
| `white` | `#FFFFFF` | Main backgrounds and text on dark blue |
| `off-white` | `#F7F8FA` | Soft page sections that need separation from white |

### Neutral palette

| Token | Colour | Intended use |
|---|---:|---|
| `text-strong` | `#172033` | Headings and important body copy |
| `text-body` | `#3F4858` | Standard paragraph text |
| `text-muted` | `#687386` | Metadata, captions and secondary details |
| `border` | `#DCE2EA` | Cards, fields and dividers |
| `surface-dark` | `#101828` | Optional dark content surfaces |

### Functional colours

| Token | Colour | Intended use |
|---|---:|---|
| `urgent` | `#C2410C` | Emergency-only labels and urgent actions |
| `success` | `#18794E` | Confirmation messages and valid form states |
| `warning` | `#B45309` | Important notices |
| `error` | `#B42318` | Form errors and destructive actions |

### Colour rules

- Blue should account for most branded colour usage.
- Keep urgent orange/red limited to genuine emergency actions.
- Do not introduce multiple bright colours for different services.
- Avoid pale blue text on white or white text on mid-blue without checking contrast.
- Accreditation logos should normally retain their official colours and approved proportions.

---

## 5. Typography

### Recommended font pairing

```text
Headings: DM Serif Display
Body/UI:  Inter
Fallbacks: Georgia, serif / Arial, sans-serif
```

Alternative heading fonts that could work are **Libre Baskerville** or **Source Serif 4**. The heading typeface should echo the established character of the logo without attempting to imitate it exactly.

### Usage

| Element | Typeface | Suggested weight | Notes |
|---|---|---:|---|
| Display heading | Serif | 400 | Use for the main hero statement only |
| H1–H3 | Serif | 400 | Keep wording direct and relatively short |
| H4–H6 | Sans-serif | 600–700 | Better for card titles and compact sections |
| Body | Sans-serif | 400 | Optimise for readability |
| Navigation | Sans-serif | 600 | Avoid all caps |
| Buttons | Sans-serif | 650–700 | Short action-led labels |
| Labels/captions | Sans-serif | 500–600 | Use sparingly |

### Suggested scale

```css
--font-size-xs: 0.8125rem;
--font-size-sm: 0.9375rem;
--font-size-base: 1rem;
--font-size-lg: 1.125rem;
--font-size-xl: 1.375rem;
--font-size-2xl: 1.75rem;
--font-size-3xl: clamp(2rem, 4vw, 3rem);
--font-size-4xl: clamp(2.5rem, 6vw, 4.25rem);
```

Body text should usually use a line height between `1.55` and `1.7`. Long paragraphs should not exceed roughly 65–75 characters per line.

---

## 6. Logo usage

### Preferred placement

- Use the standard blue logo on white or very pale backgrounds.
- Use the approved white/reversed logo on deep blue backgrounds.
- Place the logo at the left side of the primary header.
- Keep it large enough that “Plumbing & Heating” remains legible.

### Clear space

Maintain clear space around the logo equal to at least the height of the capital letter **C** divided by two.

### Do not

- recolour the logo with gradients;
- stretch or compress it;
- crop the descriptor;
- put it over a visually busy photograph without a solid container;
- add a drop shadow, glow, outline or bevel;
- recreate the wordmark in HTML text.

---

## 7. Page layout

### Grid

Use a conventional responsive container:

```css
--content-width: 1180px;
--content-narrow: 760px;
--page-gutter: clamp(1rem, 4vw, 2rem);
```

Recommended desktop grid: 12 columns.  
Recommended card grid: three columns desktop, two tablet, one mobile.

### Section spacing

```css
--section-space-sm: clamp(2.5rem, 5vw, 4rem);
--section-space-md: clamp(4rem, 8vw, 6.5rem);
--section-space-lg: clamp(5rem, 10vw, 8rem);
```

Pages should not be visually compressed. Trust is better communicated through clear hierarchy and breathing room than by placing every service above the fold.

### Shape language

Use moderately rounded corners:

```css
--radius-sm: 6px;
--radius-md: 12px;
--radius-lg: 20px;
```

Avoid pill-shaped cards and excessive rounding. Buttons may use an `8px` to `10px` radius rather than fully rounded ends.

---

## 8. Header and navigation

### Desktop header

Use two levels:

1. **Utility bar:** phone number, office hours, emergency availability and an optional email link.
2. **Primary navigation:** logo, grouped service links and a prominent booking/contact action.

Recommended primary actions:

- `Book an appointment`
- `Call 01234 325 620`

For emergency pages, use:

- `Call an emergency plumber`

### Mobile header

- Keep the logo visible.
- Provide a clear menu control.
- Keep a phone action available without opening the menu.
- Use a sticky bottom action bar only when it contains genuinely useful actions such as **Call** and **Book**.

Do not use a large multi-row desktop navigation on mobile.

---

## 9. Hero section

The homepage hero should immediately answer:

1. What does the company do?
2. Where does it operate?
3. Why should the visitor trust it?
4. What should the visitor do next?

### Recommended structure

- Local-service headline
- One or two sentences of supporting copy
- Primary call to action
- Secondary call or WhatsApp action
- Trust statement or review summary
- Real image of the team, a branded van or an engineer at work

### Example hierarchy

```text
Trusted plumbing and heating engineers in Bedfordshire

Boiler, plumbing, bathroom and heating services from an experienced
local team, with emergency support available when you need it.

[Book an appointment] [Call 01234 325 620]
```

Use either a split layout or a full-width photograph with a strong deep-blue overlay. Avoid image carousels in the hero.

---

## 10. Buttons and links

### Primary button

- background: `brand-blue`;
- text: white;
- minimum height: `48px`;
- medium-bold sans-serif label;
- clear hover and focus states.

### Secondary button

- white or transparent background;
- blue border and blue text;
- becomes pale blue on hover.

### Emergency button

Use the functional urgent colour only on emergency-specific pages or persistent emergency contact controls.

### Button wording

Prefer specific actions:

- `Book a boiler service`
- `Request a quotation`
- `Call the emergency team`
- `View boiler options`

Avoid vague labels such as `Learn more` where a more descriptive action is possible.

---

## 11. Service cards

Service cards should help visitors self-select quickly.

Each card should contain:

- a simple service icon or relevant photograph;
- a concise title;
- one short sentence;
- a descriptive text link;
- optional urgency or availability information.

### Card styling

- white or pale-blue surface;
- `1px` neutral border;
- subtle shadow only on hover;
- icon in brand blue;
- no more than two lines in a title;
- equal card heights within each row.

Do not use animated GIFs or decorative motion as the main service identifier. Static SVG icons are faster, clearer and easier to keep visually consistent.

---

## 12. Trust and evidence

Trust content should appear throughout the journey rather than being confined to a single page.

Useful trust modules include:

- recognised accreditation and manufacturer logos the company is authorised to display;
- customer review score and recent review excerpts;
- years of practical experience;
- photographs and names of team members;
- service-area information;
- workmanship or product guarantees;
- clear company address and registration information;
- photographs of completed work;
- explanations of the quotation and appointment process.

Use real evidence rather than oversized claims such as “the best plumber”.

Reviews should use a readable card or quotation format. Avoid continuous auto-scrolling review marquees.

---

## 13. Photography and imagery

### Preferred photography

Use real, well-lit photographs of:

- the team together;
- engineers working in customers’ homes;
- branded vans;
- neat boiler installations;
- completed bathrooms;
- commercial or school work where permission allows;
- apprentices and training activity.

### Image treatment

- natural colour balance;
- consistent crop ratios;
- minimal filters;
- slightly warm, human photography against the cooler blue interface;
- rounded corners only where the layout requires them.

Avoid generic stock photographs of smiling models holding spanners. They weaken the local and family-run positioning.

---

## 14. Icons and illustration

Use one coherent SVG icon family with:

- rounded or neutral line endings;
- consistent stroke width;
- simple recognisable silhouettes;
- blue as the default colour;
- no detailed clip-art or 3D rendering.

Suggested service metaphors:

- boiler: boiler outline or radiator;
- repair: spanner with pipe;
- plumbing: tap or pipe joint;
- hot water: water droplet with heat lines;
- air conditioning: snowflake and airflow;
- heat pump: fan with heat/cold indicators;
- bathroom: bath or shower;
- commercial: building outline.

---

## 15. Forms

Forms should be short and easy to complete on a phone.

### Styling

- labels above fields;
- at least `44px` field height;
- clear required/optional wording;
- light neutral borders;
- strong blue focus ring;
- errors beside the relevant field;
- a clear confirmation state after submission.

### Initial enquiry fields

Only request information needed to respond:

- name;
- telephone or email;
- postcode;
- service required;
- short message;
- preferred contact method;
- optional image upload where useful.

Avoid asking for extensive technical details before the first contact.

---

## 16. Content tone

Copy should be:

- plain English;
- confident but not boastful;
- specific about locations and services;
- reassuring during emergencies;
- transparent about what happens next;
- written in UK English.

### Preferred style

```text
We will confirm your appointment and let you know who is attending.
```

### Avoid

```text
Our world-class solutions leverage unparalleled expertise to deliver excellence.
```

Use short paragraphs, descriptive headings and practical questions customers actually ask.

---

## 17. Accessibility and interaction

The site should target WCAG AA accessibility.

Required practices include:

- visible keyboard focus styles;
- sufficient text and control contrast;
- properly associated form labels;
- useful alternative text for informative images;
- reduced-motion support;
- buttons and links with clear accessible names;
- no essential information conveyed by colour alone;
- touch targets of at least approximately `44 × 44px`;
- no autoplaying video or distracting continuous animation;
- headings in a logical document order.

Animations should be subtle and functional: small fades, short card lifts and menu transitions. Respect `prefers-reduced-motion`.

---

## 18. Responsive behaviour

### Mobile priorities

1. Contact and emergency actions
2. Service selection
3. Trust evidence
4. Booking or quotation form
5. Detailed supporting information

### Rules

- Keep paragraphs left-aligned.
- Stack split sections rather than squeezing them.
- Place the most useful content before decorative images.
- Collapse large service menus into clear categories.
- Avoid horizontal card sliders for essential services.
- Ensure telephone numbers can be tapped directly.
- Do not allow cookie controls or sticky actions to obscure page content.

---

## 19. Footer

Use a deep-blue footer containing:

- reversed white logo;
- phone number and contact action;
- address and office hours;
- emergency availability statement;
- main service links;
- service areas;
- accreditation marks where appropriate;
- company registration, VAT and finance/legal wording;
- privacy, complaints and terms links;
- social links as secondary elements.

The footer should provide reassurance and compliance information without becoming an unstructured wall of text.

---

## 20. Suggested design tokens

```css
:root {
  --colour-brand: #00309d;
  --colour-brand-hover: #002477;
  --colour-brand-deep: #071b3a;
  --colour-brand-soft: #eaf0fc;

  --colour-text: #172033;
  --colour-body: #3f4858;
  --colour-muted: #687386;
  --colour-border: #dce2ea;
  --colour-surface: #ffffff;
  --colour-surface-alt: #f7f8fa;

  --colour-urgent: #c2410c;
  --colour-success: #18794e;
  --colour-warning: #b45309;
  --colour-error: #b42318;

  --font-heading: "DM Serif Display", Georgia, serif;
  --font-body: Inter, Arial, sans-serif;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;

  --shadow-card: 0 8px 24px rgb(16 24 40 / 0.08);
  --shadow-raised: 0 16px 40px rgb(16 24 40 / 0.12);

  --content-width: 1180px;
  --content-narrow: 760px;
  --page-gutter: clamp(1rem, 4vw, 2rem);

  --transition-fast: 150ms ease;
  --transition-standard: 220ms ease;
}
```

---

## 21. Recommended homepage structure

1. Utility bar with phone and emergency availability
2. Main navigation
3. Hero with local value proposition and two actions
4. Accreditation/review trust strip
5. Main service grid
6. “Why choose Christy” section with evidence
7. Emergency plumbing callout
8. Boiler/heating feature section
9. Real team or company-story section
10. Selected project photographs
11. Customer reviews
12. Service-area section
13. Booking/contact panel
14. Footer

---

## 22. Visual anti-patterns

Avoid:

- multiple competing shades of bright blue;
- generic water-droplet backgrounds;
- flame-and-water gradients;
- oversized emergency-red banners on every page;
- glossy buttons and bevel effects;
- long walls of centred text;
- excessive animations;
- auto-rotating hero sliders;
- inconsistent icon styles;
- stock-photo engineers wearing unbranded uniforms;
- service pages that all use the same vague copy;
- hidden telephone numbers;
- low-contrast grey text;
- pop-ups appearing immediately on page load.

---

## 23. Summary

The strongest direction is a **blue-led, high-trust local-service website** that preserves the logo’s combination of established serif character and modern sans-serif clarity.

The final design should rely on:

- the existing royal blue as its primary visual identifier;
- restrained serif headings;
- clean, accessible body typography;
- real people and project photography;
- visible trust evidence;
- direct booking and telephone actions;
- simple, consistent service components;
- generous spacing and calm layouts.

This will retain Christy Plumbing & Heating’s existing identity while making the website feel more current, coherent and easier to use.
