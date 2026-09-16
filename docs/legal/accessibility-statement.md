# Accessibility

StockControl is used on a phone in a van, on a tablet in a stockroom, and on a
desktop in an office, by people who are not sitting still and are sometimes
wearing gloves. Accessibility work and "works in the real conditions" work turn
out to be mostly the same work.

## The legal position

- The **Public Sector Bodies Accessibility Regulations 2018** do not apply.
  This is not a public sector body.
- The **European Accessibility Act**, in force from 28 June 2025, applies to
  consumer-facing products and services. An internal inventory tool for a
  business's own staff is not one. If an installation is ever opened to
  consumers, that changes.
- The **Equality Act 2010** does apply, and it is the one that matters. An
  employer must make reasonable adjustments for a disabled employee, and
  software they are required to use to do their job is squarely within that.

So the obligation is not a compliance target to be certified against. It is:
if somebody who works here cannot use this, that is the employer's problem to
fix.

## What is aimed at

**WCAG 2.2 level AA**, as the working standard. Not claimed as fully met —
this statement is not a certificate.

What is done deliberately:

- Semantic HTML and real ARIA roles, so a screen reader gets a page structure
  rather than a pile of divs.
- Every interactive control reachable and operable by keyboard.
- Visible focus, which is left alone rather than styled away.
- Form fields with real labels, and errors announced rather than only coloured.
- Colour never the only carrier of meaning — a status has a word as well as a
  colour.
- Touch targets sized for a gloved hand, which also satisfies the pointer
  target criteria.
- Text that reflows to a phone without horizontal scrolling.
- `axe-core` runs in the browser test suite, so a whole class of regression is
  caught before review.

## Known to be imperfect

Recorded honestly, because a statement that claims everything works is not
believable:

- **The map editor** is a drag-and-drop canvas. Drawing and positioning a
  location by keyboard alone is not currently practical. The information it
  produces is reachable elsewhere — locations appear in lists and on item
  pages, and stock can be moved without opening a map. Somebody who cannot use
  the canvas can use the whole product except the drawing.
- **Barcode scanning** needs a camera and reasonable light. Every item can be
  found by search instead, and every scan-driven flow has a typed equivalent.
- **`axe-core` finds what it can find.** It is a floor, not a pass. It does not
  catch a confusing label or a keyboard trap that only exists in a particular
  order of operations.

## If something is in the way

Tell whoever administers your installation. If it is a bug in the software,
**Report an issue** files it — note that reports are public, so leave out
anything personal. A member of staff who needs an adjustment should not have to
file a public bug report to get one; that route is for the software, and the
employer's own process is for the adjustment.
