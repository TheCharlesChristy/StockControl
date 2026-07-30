# StockControl Product Requirements

**Status:** Approved MVP requirements baseline v1.0  
**Approved:** 28 July 2026  
**Change control:** This document is the implementation baseline. Later changes require an explicit revision and must identify their effect on scope, data, permissions, tests, and deployment.

## 1. Product vision

StockControl is an inventory-management application for small businesses with substantial stock holdings. It should make receiving, locating, reserving, issuing, returning, moving, purchasing, and auditing stock fast and dependable.

The primary outcomes are:

- reduce staff time spent administering stock;
- reduce unnecessary and duplicate expenditure;
- improve visibility of what is available, reserved, allocated, checked out, at a job site, and on order;
- make employees accountable without making routine stock handling cumbersome;
- provide an excellent experience on the devices used in the office, store, and field.

MVP outcome measures are defined in section 16.2. Customer-specific numeric improvement targets are set after an initial operating baseline is observed.

## 2. Core domain model

StockControl will distinguish between the following concepts:

- **Catalogue item / SKU:** A reusable definition such as “M6 × 30 mm zinc bolt.” It has a stable internal ID, name, unit of measure, identifying codes, and purchasing information.
- **Quantity-based stock:** A measured quantity of a catalogue item, such as 300 screws, 12.5 metres of cable, or 2.75 kilograms of material.
- **Serialized asset:** An individually tracked physical item, such as a particular drill, with its own identity and QR code.
- **Stock holding:** The quantity or serialized assets held at a particular location.
- **Reservation:** Stock committed to a job but not yet collected. An approved reservation reduces available stock immediately; a pending request represents demand but does not change availability.
- **User allocation:** Stock set aside exclusively for a named user but not yet collected.
- **Custody / checkout:** Reusable stock that has physically been issued to a user and is expected to be returned.
- **Transaction:** An auditable record of a receipt, issue, consumption, return, transfer, adjustment, write-off, reservation, release, allocation, or other stock event.
- **Location:** A coded place within a hierarchy and, where applicable, on a visual map.
- **Job:** An internally managed piece of work to which stock can be requested, reserved, issued, consumed, returned, or reconciled.

## 3. Inventory and catalogue

### 3.1 Confirmed requirements

- Both quantity-based stock and individually serialized assets must be supported.
- Units may be whole or fractional where appropriate.
- Units of measure must include counted units and measured units such as grams, kilograms, millimetres, metres, millilitres, and litres.
- Pack conversions must be supported, for example one box containing 100 individual screws.
- Tracking mode and handling policy are independent:
  - tracking mode is **quantity-based** or **serialized**;
  - handling policy is **consumable**, **partially consumable**, or **returnable**.
- Returnable stock must be serialized in the MVP so custody and return can be attributed to a specific asset.
- The same catalogue item may be held in multiple locations. A nearby “cache” and a larger remote store are a representative use case.
- Existing items should be recognised using exact identifiers such as a barcode or manufacturer part number, with user confirmation. Name search should help the user find candidates but must not silently merge records.
- New catalogue items receive a unique, stable internal ID.
- Inventory must be searchable.
- The main inventory view must show at least the item ID, name, available quantity, reserved quantity, and location information.
- Items can use different access classifications. At minimum, the system must distinguish free-use, standard, and privileged stock.
- Access behaviour remains configurable per item or item category:
  - **Free-use:** A permitted Engineer may self-issue without prior approval. A job is optional, but the quantity, user, and destination are still logged.
  - **Standard:** A permitted Engineer may self-issue, but must record a job, user, van, or other configured purpose.
  - **Privileged:** Explicit entitlement or approval is required and configurable safeguards apply.
- Consumable items may use a configurable **consume on issue** policy. This is suitable for inexpensive items such as screws; other consumables remain at a job or van location until explicitly consumed or reconciled.
- Van inventory is visible but excluded from general fulfilment availability unless an authorised transfer or recall makes it available.
- Quantity stock conditions include **Usable**, **Quarantined**, **Damaged**, and **Expired**.
- Serialized-tool conditions include **Good**, **Damaged—usable**, and **Unsafe**.
- Allocation, custody, transit, missing, retirement, and write-off are lifecycle states or events rather than physical conditions.
- Only stock in an applicable usable condition contributes to availability.
- Engineers may immediately report damaged, unsafe, missing, or otherwise suspect stock. An appropriately permitted Office or Admin user controls release from quarantine, restoration to use, and write-off.
- Batch-controlled stock is picked using earliest-expiry-first-out guidance by default.
- Reaching an expiry date automatically makes the affected stock unavailable and creates an action-required notification. Office/Admin must return it to the supplier, dispose of or write it off, transfer it to an allowed exception process, or correct erroneous expiry data through an audited action.

### 3.2 Additional MVP requirements

- “Create catalogue item” and “receive stock” are distinct operations presented as one guided add-stock flow when helpful.
- Catalogue IDs are never reused. Retired items are archived rather than erased.
- The main inventory table shows one aggregate row per catalogue item, expandable to show balances by location, pack, batch, or individual asset.
- Availability is calculated rather than manually entered.
- Routine stock operations include receipt, consumption, checkout, return, transfer, reservation, release, allocation, collection, adjustment, stocktake, damage, loss, and write-off.

The MVP uses:

`available now = usable stock in eligible fulfilment locations - source-allocated job reservations - source-allocated user allocations`

`projected at date = available now + confirmed inbound due by that date - uncommitted demand due by that date`

- Vans, job sites, user custody, quarantine, expiry, missing assets, and in-transit assets are excluded from general fulfilment availability.
- Approval atomically allocates a reservation or user allocation to exact source locations or serialized assets. A line may split across several source locations.
- The system rejects over-reservation and double commitment.
- A linked reservation and purchase request represent the same demand and are counted once in projected demand.
- If committed stock becomes damaged, expired, missing, or otherwise unusable, the commitment becomes a visible shortfall and is never silently substituted.

### 3.3 Inventory dashboard and add-stock flow

- After sign-in, the responsive application presents the user’s role dashboard and primary navigation.
- The inventory view contains a searchable table showing at least item ID, name, on-hand quantity, available quantity, reserved quantity, condition, and location summary.
- Search covers internal ID, name, manufacturer part number, barcode alias, category, and location. The table supports sorting, filtering, and an expandable per-location balance.
- An authorised user selects **Add stock** to open a focused modal or mobile sheet.
- The flow first searches or scans for an existing catalogue item. An exact identifier match resolves the stable item ID and catalogue details, then asks the user to confirm the match.
- Receiving an existing item asks only for receipt-specific details such as quantity or serials, pack, supplier or purchase order, price/VAT where applicable, condition, and destination location.
- If no existing item is confirmed, the same flow creates a catalogue item and then receives its opening stock. Required catalogue choices include tracking mode, handling policy, base unit, pack conversions where applicable, access class, identifiers, and reorder settings.
- Suspected duplicates are shown for explicit resolution; the application never silently merges catalogue records.
- After a successful receipt, the user can print the relevant item or asset labels and open the created transaction.

## 4. QR codes

### 4.1 Confirmed requirements

- Catalogue items and serialized assets can have QR codes generated and printed.
- Scanning a QR code opens the relevant mobile-friendly page in StockControl.
- A permanent item or asset QR remains valid when the stock is reserved or allocated.
- Job reservations and user allocations may have their own QR codes identifying those records; they do not replace the permanent identity label.
- Scanning a QR code does not itself grant permission. The user must authenticate and the server must enforce their current permissions.
- QR-driven flows must support fast stock actions such as collection, consumption, checkout, return, and movement when applicable.
- QR labels use configurable browser/PDF templates supporting A4 sheets and common thermal-label sizes.
- Labels contain the permanent QR code, human-readable ID, short item name, and optional location.
- Reprinting a label retains the same record identity and QR target.
- Existing manufacturer and supplier barcodes can be stored as scannable aliases for a catalogue item.

### 4.2 MVP label scope

- Item, serialized-asset, reservation, user-allocation, and job collection records support QR output where applicable.
- Location QR labels are not required for the MVP; stable human-readable location codes are required.
- The MVP provides configurable A4 and generic thermal-label PDF templates.
- Direct integration with proprietary label-printer drivers is outside the MVP; printing uses the browser and generated PDF documents.

## 5. Jobs, reservations, and job-site stock

### 5.1 Confirmed requirements

- Jobs are created and managed inside StockControl.
- Engineers can submit reservation requests.
- Office and Admin users can approve requests and create reservations, subject to their effective permissions.
- A pending request is visible as demand but does not reduce the available quantity.
- An approved reservation immediately reduces the available quantity.
- Approved reservations have a collection deadline and expiry.
- Only users on an allowed collector list may collect reserved stock.
- Partial and repeated collection must be supported.
- Stock committed to a job must remain location-tracked, whether it is still in a store or has moved to a job site.
- Every job has one automatically created virtual job-site location.
- Equivalent item substitutions are supported.
- Office and Admin users create jobs by default. Selected Engineers may receive an individual job-creation permission.
- A job records at least its job number, name, customer, address, start date/time, deadline, status, notes, cost centre, and allowed collectors.
- Job states are **Draft**, **Active**, **On hold**, **Completion requested**, **Cancellation requested**, **Reconciliation required**, **Completed**, and **Cancelled**.
- **On hold** prevents new collection without automatically releasing existing reservations.
- Cancelling or completing a job begins a stock reconciliation process.
- A completion or cancellation request immediately stops new collection and releases uncollected reservation quantities. Only stock already collected or transferred to the job requires reconciliation.
- An Engineer records the disposition of job stock and a different appropriately permitted Office or Admin user normally signs off the reconciliation.
- A privileged user may override the normal closeout rules, including closing with outstanding stock, but the exception, reason, continuing custody, and job-site location remain active, visible, and auditable until the stock is resolved.
- Office and Admin users with the relevant permission may extend a reservation expiry with a reason. Changing a job deadline does not silently extend existing reservations.
- The authenticated collector and receiving custodian may be different people. Both identities are recorded, and the receiving custodian must be eligible for the allocation or job.

Allowed job transitions are:

| From                                           | To                                             | Normal authority or trigger                      |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Draft                                          | Active                                         | Office/Admin activates the job                   |
| Active                                         | On hold                                        | Office/Admin pauses collection                   |
| On hold                                        | Active                                         | Office/Admin resumes the job                     |
| Active or On hold                              | Completion requested or Cancellation requested | Engineer or other permitted user begins closeout |
| Completion requested or Cancellation requested | Reconciliation required                        | Engineer submits stock disposition               |
| Reconciliation required                        | Completed or Cancelled                         | Independent Office/Admin sign-off                |
| Completion requested or Cancellation requested | Active or On hold                              | Office/Admin rejects the closeout request        |
| Reconciliation required                        | Active or On hold                              | Office/Admin reopens the job for further work    |

An Admin may perform an exceptional transition with a mandatory reason, but cannot erase outstanding stock, custody, or history.

### 5.2 Confirmed lifecycle

1. A job is created with its work details, site, status, and permitted collectors.
2. An Engineer requests stock for the job.
3. An authorised user approves, amends, rejects, or fulfils the request.
4. Approval creates a reservation and reduces available stock without changing physical on-hand quantity or location.
5. Collection records the actual quantity or assets issued and their real outcome: immediate consumption for **consume on issue**, movement to a job site or van, or serialized-asset custody. The screen defaults to the full outstanding quantity but permits a smaller quantity.
6. During the job, issued stock may be consumed, returned, transferred, marked damaged, or remain at the job site.
7. An Engineer begins closeout by moving the job to **Completion requested** or **Cancellation requested**; new collection stops and uncollected reservations are released.
8. The Engineer records and submits the disposition of collected stock, moving the job to **Reconciliation required**; discrepancies require a reason and, where configured, approval.
9. An authorised reviewer signs off the reconciliation before the job becomes **Completed** or **Cancelled**.

The system independently records the requested, approved/reserved, collected, consumed, returned, released, and outstanding quantities. For example, if 20 metres are reserved and 12 metres are collected, 12 metres leave the reservation and are recorded against their actual issue outcome or destination; the remaining 8 metres stay reserved until collected, released, or expired. Serialized assets remain indivisible. Approval must never silently under-allocate a request.

For every line:

`open reserved = approved - collected - released - expired`

`job stock = collected + transfers in - consumed - returned - transferred out - written off`

When a reservation expires, only its uncollected remainder is released. Already collected stock remains associated with the job and must be reconciled. Users should receive advance and expiry notifications.

The collect-by date defaults to the job deadline. The system creates a reminder on the day before the job window and every 24 hours during the active job window until collection, expiry, or closure.

Substitutions come from catalogue-defined equivalent groups. The requesting Engineer normally accepts the proposed substitute. A privileged Office or Admin user may override acceptance with a mandatory reason. The original item, substitute, conversion, approver, acceptance or override, and reason remain in the audit trail.

## 6. User allocation and custody

### 6.1 Confirmed requirements

- Allocation and custody are separate states:
  - **Allocated:** waiting exclusively for the named user to collect;
  - **Checked out / in custody:** physically held by that user.
- Stock allocated to a user is unavailable to other users.
- Allocations have unique QR links that support collection while retaining the item or asset’s permanent QR identity.
- Transfer, return, and authorised override actions must be supported and audited.
- Reusable tools are normally assigned directly to Engineers rather than allocated to jobs.
- A serialized tool retains a named custodian and a separate current physical location, such as a van, store, repair location, or job site.
- Moving a tool temporarily to a job site does not allocate its cost to the job.
- Issuing, returning, or transferring a reusable tool does not create material expenditure. Its acquisition cost remains attached to the asset until disposal, loss, or write-off.

### 6.2 Confirmed reusable-tool model

- A reusable tool has a permanent asset ID and QR, catalogue model, manufacturer serial where available, individual acquisition cost, purchase reference, and at most one primary accountable custodian.
- A normally held tool has exactly one current location. An in-transit tool records its origin and destination instead; a missing tool retains its last known location.
- Assignment can represent either an indefinite Engineer kit with no return deadline or a temporary loan with an expected return date and overdue status.
- A van may authorise several Engineers to use its tools while retaining one named primary custodian for accountability.
- Assignment, physical custody, current location, and optional job-usage history are separate facts.
- Brief use at a job may be recorded without changing location. If the tool is stored at the job site, its location changes while its Engineer custody remains.
- Tool lifecycle states include **Available**, **Assigned awaiting collection**, **In custody**, **Transfer pending**, **In transit**, **Returned awaiting inspection**, **Under repair**, **Missing**, **Retired**, and **Written off**. Its separate condition is **Good**, **Damaged—usable**, or **Unsafe**.
- Collection starts custody. Return ends custody after a condition check.
- Engineer-to-Engineer transfer follows **Requested → Office approved → Sender dispatched → In transit → Recipient accepted**.
- The sender retains accountability until the recipient accepts the tool and records its condition. Rejection or timeout creates a visible Office exception and does not silently change custody.
- An Office user may record acceptance on the Engineer’s behalf; the acting user, represented recipient, condition, and reason are retained in the audit history.
- Condition is recorded at issue, transfer, and return using at least **Good**, **Damaged—usable**, and **Unsafe**.
- A missing report immediately makes the tool unavailable. Final write-off requires configured approval; recovery requires inspection and preserves the full history.
- Tool calibration, scheduled servicing, detailed maintenance management, repair-invoice tracking, depreciation, and capital-asset accounting are outside the initial product scope.

### 6.3 User allocations and offboarding

- A particular quantity portion or serialized asset can participate in only one active commitment at a time. A larger fungible balance may support several commitments only when their total does not exceed availability.
- A user allocation is a non-job reservation for one named collector. It immediately reduces availability when approved and remains active until collection, release, or expiry.
- Collection converts the allocation into consumption, a recorded van or storage holding, or serialized custody according to the item’s handling policy.
- Deactivating a user who has allocations, consumable holdings, or tool custody creates an Office/Admin offboarding exception. Their stock remains visible and must be released, returned, transferred, reconciled, or explicitly overridden.

### 6.4 Allocation and custody defaults

- Every uncollected user allocation has a collect-by date, defaulting to seven days after approval. Expiry automatically releases only its uncollected quantity or assets; Office/Admin may extend it with a reason.
- An Office or Admin user with the relevant permission may collect, accept, transfer, or return stock on another user’s behalf. The represented user, acting user, and reason are all recorded.
- Consumables without a job are permitted when the item’s access and handling policy allows them. On collection they are either consumed on issue or moved to a concrete van or storage location; the MVP does not create unlocated quantity balances held only against a user.
- Tool issue and return record condition. Loss, disposal, retirement, and write-off require the configured permissions and reason and never erase custody history.
- A returned **Damaged—usable** tool remains unavailable until Office confirms it may be used.

## 7. Locations and maps

### 7.1 Confirmed requirements

- A customer deployment supports one business branch in the initial product scope.
- A branch may contain multiple storage buildings, each with its own visual map.
- Location management must provide both:
  - a hierarchy such as Branch → Building → Area → Aisle → Shelf → Bin; and
  - an interactive visual editor with sections and subsections.
- Location codes and human-readable names are used throughout inventory operations.
- Inventory can be transferred between locations, including between a local cache and a larger store.
- Engineer vans are persistent mobile inventory locations.
- Each van is assigned to one or more Engineers.
- Each job has one temporary virtual job-site location.
- The location hierarchy is authoritative and each visual region links directly to a hierarchy node.
- A map may begin from an uploaded floor plan or a blank canvas.
- The editor supports named and nested rectangles or polygons, map search, and stock-status colouring.
- Maps are abstract visual aids. Precise scale, measurement, and route planning are not required.

### 7.2 Location identity requirements

- Every location receives a stable unique code that is not reused.
- Names and visual geometry may change without changing the stable location identity.
- Occupied or historically referenced locations are archived rather than deleted.
- A visual region is linked to a node in the location hierarchy.
- Human-readable location-code labels can be bulk printed.
- Job sites and vans remain trackable without requiring floor-plan geometry.
- An empty job-site location is deactivated after job closure but retained for historical audit records.

### 7.3 MVP van and location rules

- The MVP does not provide general building- or bin-scoped user permissions. Item access classes, role permissions, job collector lists, allocations, and van custody provide operational restrictions.
- Van stock is visible to authorised Office/Admin users but remains excluded from general fulfilment availability.
- A job reservation does not silently source from a van. The assigned Engineer may issue permitted van stock to their job, or Office/Admin may initiate a recall or proposed van-to-job transfer.
- The assigned Engineer confirms the physical handover or movement; an Admin may complete it through a reasoned audited override. The stock may move directly to a job or an eligible fulfilment location.

## 8. Purchasing and replenishment

### 8.1 Confirmed requirements

StockControl must support the complete purchasing workflow rather than stopping at a request.

- Every supplier purchase requires explicit approval by a user with Buyer approval permission. StockControl does not place automatic orders.
- A requester cannot approve their own request or provide the final approval for a purchase order created from it.
- StockControl generates a uniquely numbered, printable purchase-order PDF.
- Pending reservation and purchase requests are visible as demand but do not reduce current availability.
- Office users receive an out-of-stock notification when there is unmet demand.
- Items may have configurable low-stock thresholds.
- A projected-shortage notification is created when pending demand would take an item below its threshold.
- The system must account for stock already on order before recommending duplicate procurement.

### 8.2 Confirmed workflow

1. An Engineer or other permitted user raises a stock request.
2. Equivalent open requests, existing stock, reservations, and quantities already on order are shown to prevent duplicate purchasing.
3. A Buyer approves, amends, rejects, or consolidates requests.
4. Approved demand is assigned to a supplier in a **PO Draft**.
5. A permitted Buyer approves the purchase order before it becomes **Ordered**.
6. Partial and complete deliveries move it through **Part Received** to **Closed**.
7. Receipt creates inventory transactions and resolves the related ordered quantity.
8. Variances, back orders, cancellations, and returns to supplier are recorded.

The workflow includes supplier records, supplier item codes, cost history, preferred pack sizes, reorder levels, lead times, quantities on order, and usage information.

The replenishment calculation is:

`projected available = usable fulfilment stock - approved uncollected job reservations - approved uncollected user allocations + confirmed inbound due in time - uncommitted pending demand`

Before suggesting a purchase, the system checks for stock in other buildings or bulk-storage locations, suggests an internal replenishment transfer where appropriate, accounts for confirmed purchase orders, and only then suggests a supplier order. Suggested quantities target a configured stock level and respect supplier pack sizes and minimum order quantities.

Alerts should be deduplicated and remain visible until acknowledged or until the shortage is resolved.

### 8.3 Costing and receiving

- StockControl owns the operational purchasing and stock-cost subledger only. It does not provide job pricing or revenue, a general ledger, bank payment execution, VAT return submission, payroll, or statutory accounts.
- Each customer installation has one configurable base currency.
- Every MVP purchase document uses that base currency. Foreign-currency purchasing is deferred.
- Purchasing records supplier prices, discounts, tax/VAT, price history, and price variance.
- Purchase documents retain net amount, VAT rate and code, VAT amount, gross amount, recoverable portion, supplier VAT details, invoice date, tax point where applicable, and the underlying document.
- The MVP supports configurable UK purchase-VAT codes and rates, including standard, reduced, zero-rated, exempt, and outside-scope treatment; it records supporting data but does not prepare or submit a VAT return.
- Recoverable VAT is tracked separately and excluded from stock cost. Non-recoverable tax is included in stock cost.
- Directly attributable freight, import duty, handling, rebates, and discounts form part of true acquisition cost using an auditable allocation rule.
- Interchangeable quantity stock uses a perpetual moving weighted-average cost per SKU across the branch.
- Individually identified serialized assets retain their specific acquisition cost.
- Reports separate consumable inventory valuation from reusable-tool acquisition value so that tools are not counted as consumed materials or job expenditure.
- Inventory is carried at the lower of cost and estimated recoverable value. Damaged, obsolete, expired, or otherwise impaired stock supports authorised write-down and later reversal where appropriate; reversal cannot raise value above the cost that would otherwise apply.
- Internal transfers preserve stock cost.
- Returning physically tracked unused stock is an internal transfer and does not change total value. Reversing a prior **consume on issue** transaction restores the returned quantity at that transaction’s original consumption cost.
- Waste, loss, and write-offs retain their cost and are reported against the responsible job, user, van, or location rather than being absorbed into remaining stock.
- Negative stock is prohibited.
- Goods receipt initially uses the approved purchase-order cost. A later invoice variance creates an auditable cost adjustment rather than rewriting the original receipt.
- Each receipt retains cost provenance and the quantity from that receipt estimated to remain on hand. This supports deterministic allocation of a later invoice variance between current inventory value and exited-stock purchase-price variance.
- Quantity and cost are stored in the item’s base unit with sufficient internal precision; pack conversions and display rounding do not change total value.
- Receiving supports multiple partial deliveries, backorders, authorised over-delivery, damaged deliveries, supplier returns, and credit outcomes.
- Batch/lot number and expiry date are optional per item and are captured when relevant.
- Serialized assets are identified and destination locations are selected during receipt.
- Over-delivery and other financial or quantity variances require the configured permission, reason, and safeguards.
- Supplier invoices and credit notes are captured and retained. They support multiple and partial invoices, attachments, due dates, duplicate detection, and three-way matching against the purchase order and goods receipts.
- StockControl records invoice payment status, date, balance, and an optional external accounting reference but does not initiate or reconcile bank payments. Payment status is entered manually in the initial release.
- Supplier returns track the physical return separately from the expected and received financial credit.
- StockControl must provide complete visibility of inventory value and money attributable to purchasing, stock movement, consumption, returns, waste, loss, invoice variance, and supplier credits.

Request, purchase-order, receipt, invoice matching, payment, supplier return, and credit states are tracked independently so partial and exceptional flows do not overwrite one another. The dashboard may summarise them as **Requested**, **Committed on PO**, **Received not invoiced**, **Invoiced unpaid**, **Paid**, and **Credited**.

Manual invoice payment status is **Unpaid**, **Part paid**, **Paid**, **Disputed**, or **Void**. Each change is additive and audited.

### 8.4 Material expenditure

- A reservation shows committed material cost but creates no accounting movement.
- Collection shows material allocated to a job or user but does not by itself create actual expenditure unless the item is configured to consume on issue.
- Consumption creates actual material expenditure.
- Returning physically tracked unused material reverses its allocation through an internal transfer without changing total value. A return after **consume on issue** uses a linked reversal at the original consumption cost.
- Waste or loss remains attributable expenditure for the responsible job, user, van, or location.
- Reusable tools do not create job expenditure when issued or returned. StockControl retains their acquisition cost and custody history but does not calculate depreciation or an internal rental charge.
- Tool loss or disposal reports the individual acquisition cost and external accounting reference; the accounting system remains responsible for depreciation, capitalisation policy, and statutory book value.
- StockControl does not calculate job revenue, charge-out prices, labour cost, or profitability.

### 8.5 MVP financial defaults

- Every purchase requires Buyer approval and the requester cannot approve their own request.
- The same Buyer may approve both the request and final purchase order provided they were not the requester and remain within their effective approval limit.
- An Admin may configure per-user purchase-approval limits and a value above which additional Admin approval is required. A full budgeting module is outside the MVP.
- The MVP has no direct accounting, customer, bank, or supplier-system integration. It provides the defined reports and CSV exports and records optional external references.
- Reorder points and target levels are set per item for the branch. Optional location minimums and targets may trigger an internal cache-replenishment suggestion before purchasing.
- Landed costs default to allocation by line net value. An authorised user may instead select quantity or weight for a particular charge; the selected method is retained for audit.
- Ordinary users cannot backdate stock or cost calculations. An authorised correction may record the real-world effective date, but it posts a current linked adjustment and does not rewrite historical weighted-average calculations.
- Invoice variance attributable to stock still held adjusts its current weighted-average cost. The portion attributable to already consumed stock is recorded as a linked purchase-price variance against the original material destination.

## 9. Users, roles, and permissions

### 9.1 Confirmed requirements

StockControl provides three standard role templates:

- **Engineer:** Takes out permitted stock and submits stock-order and reservation requests.
- **Office:** Receives and manages stock, jobs, reservations, allocations, and purchasing according to granted permissions.
- **Admin:** Has full administrative and operational control.

Each user starts with one of these templates, but their permissions can be adjusted individually.

### 9.2 Confirmed permission model

- Permissions are grouped by feature area, such as Inventory, Jobs, Purchasing, Locations, Reports, and Users.
- Each per-user permission has three settings: **Use role default**, **Allow**, or **Deny**.
- An explicit per-user Allow or Deny overrides the role-template default.
- Only users with the permission-management capability can change another user’s permissions; this capability defaults to Admin only.
- A user cannot change their own permissions.
- Every permission change records the actor, time, previous value, new value, and reason.
- At least one active Admin with user and permission management must always remain.
- A job’s allowed collector list is a job-specific authorisation in addition to general role permissions.
- Sensitive items may require item-specific authorisation independently of the user’s general role. Location actions still enforce custody, reservation, and movement rules, but general building/bin-scoped user permissions are deferred.
- Sensitive actions support configurable safeguards such as mandatory reasons, quantity or value limits, re-authentication, and approval by a second user.
- Privileged users retain operational flexibility, but no override can bypass authentication or audit recording.
- Authorisation resolves in this order: explicit per-user **Deny**, effective capability, contextual item/job/van rules, then any explicitly supported reasoned Admin override.
- Purchase self-approval, authentication, audit creation, and protection of the final active Admin are never overrideable.

The standard role defaults are:

| Capability                   | Engineer                | Office                                 | Admin                               |
| ---------------------------- | ----------------------- | -------------------------------------- | ----------------------------------- |
| View, search, and scan stock | Yes                     | Yes                                    | Yes                                 |
| Take stock                   | According to item rules | According to item rules and safeguards | Full control with audited overrides |
| Reservations                 | Request and collect     | Create, approve, and amend             | Full control                        |
| Job reconciliation           | Record and submit       | Independently approve                  | Approve or override                 |
| Catalogue and receiving      | View                    | Manage                                 | Full control                        |
| Purchasing                   | Submit requests         | Process within configured limits       | Configure and override              |
| Maps and location codes      | View                    | View and use                           | Manage                              |
| Users and permissions        | No                      | No by default                          | Manage                              |
| Audit records                | Own activity            | Operational audit                      | Complete audit and export           |

### 9.3 Authentication

- Accounts are invite-only and belong to named individuals; shared user accounts are not permitted.
- Initial authentication uses email address and password.
- Multi-factor authentication is mandatory for Admin users and optional for other users.
- A shared physical device may be used, but each action must occur in the named user’s authenticated session.
- Disabling a user prevents new authentication and must invalidate their active sessions.
- User invitations expire after 72 hours and can be revoked or reissued.
- Password-reset links are single-use, short-lived, and invalidate existing sessions after a successful reset.
- Admins receive one-time MFA recovery codes. If these are unavailable, recovery requires approval by another active Admin or a documented vendor identity-verification process.
- Permission changes, purchase approval, financial override, write-off, and other configured sensitive actions require recent authentication.
- Standard sessions expire after two idle hours and 12 absolute hours by default. Admin sessions expire after 30 idle minutes and 12 absolute hours. Admins may configure shorter limits.
- Authentication attempts are rate-limited and security-relevant sign-in, recovery, MFA, and session-revocation events are audited.

## 10. Audit and accountability

### 10.1 Transaction history

All stock-changing actions must create immutable audit records containing, where applicable:

- acting user and effective permission;
- date and time;
- action and reason;
- catalogue item or serialized asset;
- quantity and unit;
- source and destination location;
- related job, reservation, allocation, user, request, or purchase order;
- prior and resulting stock state;
- correction or reversal linkage.

Historical transactions are not silently edited or deleted. Mistakes are corrected through linked reversals or corrective transactions.

- Audit records retain both the actual recording time and, where permitted, the effective transaction date.
- An Office user may correct an open-period mistake through a reasoned linked reversal or adjustment.
- Material corrections and corrections affecting a closed purchase, invoice, stocktake, or job record require Admin approval.
- Matched receipts and invoices are corrected through linked return, credit, or cost-adjustment records rather than alteration.

- Operational transaction and permission audit records are retained for the life of the customer deployment.
- Purchasing, invoice, credit-note, and VAT-supporting records are retained for at least six years by default.
- The transaction audit report provides filtered CSV export and a printable browser view.
- Every correction requires a reason. Admin-configurable quantity and value thresholds determine when independent approval is required; every write-off requires approval by default.
- Automated behavioural or fraud detection is outside the MVP.
- Security logs may retain the session, client type, and network address needed for incident investigation. StockControl does not create persistent device fingerprints for employee monitoring.

### 10.2 Stocktakes

- StockControl supports both full stocktakes and location-based cycle counts.
- Starting a count snapshots the expected physical on-hand stock at the selected location, including reserved stock that has not physically moved.
- The initial count is blind: the counter does not see the expected quantity.
- The interface warns that a location is under count, but normal work is not blocked. Any movement during the count is audited and invalidates affected count lines, which must be recounted before posting.
- Configurable quantity and value thresholds determine when an independent recount or approval is required.
- Every serialized-asset discrepancy requires recount.
- Count differences never directly overwrite a balance. Approved differences create immutable adjustment transactions with the count, expected amount, variance, actor, approver, and reason.
- Any variance remaining after required recount must be approved before an adjustment posts.
- Permissions distinguish starting a count, entering a count, recounting, approving a variance, and posting an adjustment.

## 11. Onboarding, training, and help

### 11.1 Confirmed requirement

StockControl must provide an onboarding and training process covering all features.

- Training is optional by default in the initial product.
- Comprehensive documentation is required now; more rigorous training workflows may be added later.

### 11.2 Initial documentation and onboarding scope

- An Admin setup wizard configures the organisation, branch, buildings, locations, users, permissions, catalogue defaults, and purchasing settings.
- Documentation covers every product feature and is organised into Admin, Office, and Engineer paths.
- Documentation includes initial setup, catalogue and receiving, stock operations, QR printing and scanning, jobs and reconciliation, locations and maps, purchasing, users and permissions, audit, reporting, and troubleshooting.
- The application provides contextual links from relevant screens to the associated documentation.
- A role-aware first-use checklist may guide users through their available features without blocking their work.
- A customer can start from a completely empty installation and manually create every required record through the application.
- CSV import is an optional setup accelerator, not a prerequisite.
- Validated CSV templates support catalogue items, barcode aliases, locations, opening quantities and values, serialized assets, and suppliers.
- Import provides a dry run, validation errors, duplicate detection, and an opening-balance reconciliation report before data is committed.

Formal assessments, acknowledgements, completion reporting, and permission-gated training are deferred until the later training phase.

## 12. Deployment and platform

### 12.1 Confirmed requirements

- StockControl is sold as a dedicated single-customer deployment rather than a shared multi-customer service.
- Each purchaser receives an isolated installation on a server and a unique domain.
- The customer bears the deployment and operating costs.
- Each installation contains one customer business.
- A network connection may be assumed. Offline operation is not required in the initial product.
- The interface must work across desktop, tablet, and phone form factors.
- StockControl is a responsive browser application rather than separate native desktop and mobile applications.
- It supports current mainstream browsers on Windows, macOS, iOS, Android, and Linux where the browser is supported.
- The StockControl vendor retains ownership of the software and remains responsible for server provisioning, domains, TLS certificates, backups, restore testing, monitoring, software upgrades, and security updates.

### 12.2 MVP technical requirements

- Phone and tablet cameras can scan QR codes; dedicated scanners that behave like keyboards are also supported.
- All domains use HTTPS.
- QR and transaction endpoints protect against accidental duplicate submission after retries.

### 12.3 MVP operational baseline

- The initial product serves a small number of very small customers. It does not require an enterprise availability SLA, multi-region architecture, or large-scale performance programme.
- Each customer installation should be acceptance-tested with at least 50 named users, 20 concurrent sessions, 25,000 catalogue items, 100,000 serialized assets, and one million retained transactions. These are engineering targets rather than advertised contractual limits.
- Under that profile, ordinary pages and searches should normally respond within two seconds, excluding the customer’s network latency.
- The service uses automated health checks and error monitoring. Support and restoration are best-effort during the MVP phase rather than governed by a contractual SLA.
- Planned maintenance receives reasonable advance notice and is scheduled outside the affected customer’s normal working hours where practical.
- Each installation receives an automated encrypted daily backup retained for at least 30 days.
- The restore process is documented and tested before the first customer launch and after material infrastructure changes.
- Security fundamentals remain mandatory: HTTPS, modern password hashing, MFA for Admins, restricted database access, secrets outside source control, least privilege, dependency monitoring, and audit logging for sensitive actions.
- Core operational workflows target WCAG 2.2 AA principles, including keyboard use, visible focus, sufficient contrast, large touch targets, text alternatives, and no colour-only status meaning. Formal accessibility certification is outside the MVP.

### 12.4 MVP support and data defaults

- The supported browser baseline is the latest two stable major versions of Chrome, Edge, Firefox, and Safari, including mobile Chrome and Safari.
- Support is best-effort during UK business hours for the MVP, with automated critical-service alerts to the vendor.
- Releases are vendor-controlled, versioned, tested, documented, and scheduled outside customer working hours where practical.
- The vendor owns the software. The customer owns the operational data entered into and produced by its installation.
- Customer-facing data is exportable through the defined CSV and printable report outputs. A vendor-assisted machine-readable export is available when a customer leaves.
- Licensing, hosting jurisdiction, contractual uptime, end-of-contract handover, and deletion terms are established separately in each customer contract; they do not expand the MVP application scope.

## 13. Notifications

### 13.1 Confirmed requirements

- The initial release uses in-application notifications only.
- Whether acknowledgement is required depends on the notification type and its configured policy.
- Administrative notifications and acknowledgement requirements never block normal work. Separate business safeguards may require approval or an explicitly supported reasoned override.
- Notifications include actionable links to the affected item, job, reservation, purchase, approval, or audit record.
- Reservation reminders are created on the day before the job window and every 24 hours within the active job window.
- Office users are notified of out-of-stock demand, projected shortages, and configured low-stock thresholds.

### 13.2 Confirmed notification centre

- Notifications have a type, severity, recipient or responsible role, created time, and relevant read, acknowledged, and resolved states.
- Acknowledgement records awareness or acceptance of responsibility; resolution records completion of the underlying issue.
- **Informational:** May be read or dismissed without acknowledgement.
- **Action required:** One authorised owner acknowledges responsibility and later resolves or reassigns it.
- **Personal reminder:** The named recipient acknowledges each occurrence.
- **Critical:** Requires explicit acknowledgement and escalates until acknowledged or overridden, but does not block normal work.
- Equivalent active notifications are deduplicated.
- Recurring reminders update the existing active notification and its history rather than creating an unrelated duplicate acknowledgement obligation.
- Routine notifications repeat only after material state changes or escalation, except for the agreed reservation reminder schedule.
- Default events include reservation requests, approvals, rejections and expiries; allocations ready for collection; low stock and projected shortages; purchasing delays and receipts; overdue reusable assets; reconciliation and stocktake variances; and privileged actions or overrides.
- Users see notifications relevant to their effective permissions. Admins may configure item thresholds and notification rules.

### 13.3 MVP acknowledgement defaults

- Informational notifications do not escalate.
- Personal reminders follow their workflow-specific schedule and remain assigned to the named recipient.
- An unacknowledged action-required notification is re-alerted after 24 hours and escalated to an appropriate Office/Admin user after 48 hours by default.
- A critical notification is immediately visible to its designated users and repeats until acknowledged or resolved.
- A disabled user’s unresolved notifications are reassigned to Office/Admin.
- Bulk acknowledgement is disabled by default for personal, action-required, and critical notifications.
- Admins may configure acknowledgement and escalation policy by notification type, but notifications never block ordinary work.

## 14. Dashboards and reporting

### 14.1 Confirmed dashboards

- **Engineer:** Collections, expiring reservations, van and custody stock, and submitted requests.
- **Office:** Pending approvals, shortages, incoming deliveries, overdue reusable assets, and stocktake variances.
- **Admin:** Inventory valuation, usage by job, item, and user, stock accuracy, shrinkage, dead stock, and purchasing trends.
- Dashboard information respects the user’s effective permissions.
- Reports provide date and other relevant filters, CSV export, and a printable browser view.

### 14.2 Locked MVP reports

- **Inventory:** Current quantities, conditions, locations, availability, reservations, allocations, custody, vans, job-site stock, and value.
- **Transactions:** Receipts, movements, issues, consumption, returns, corrections, write-offs, actors, reasons, and linked records.
- **Shortages and expiry:** Low stock, projected demand, out-of-stock demand, internal replenishment opportunities, expiring batches, and expired stock requiring action.
- **Purchasing and VAT:** Requests, purchase orders, receipts, invoices, credits, payment status, supplier spend, net amount, VAT, gross amount, and variance.
- **Job materials:** Requested, reserved, collected, consumed, returned, released, wasted, lost, outstanding, and associated cost.
- **Tool custody:** Asset, primary custodian, authorised van users, current location, condition, assignment type, overdue loan, missing status, and transfer state.
- **Stocktake variance:** Expected, counted, recounted, variance, value, actor, approver, adjustment, and reason.

Each report provides appropriate filters, CSV export, and a printable browser view. Purchase orders and QR labels retain their purpose-built PDF output.

Custom report building, saved report design, scheduled reports, emailed reports, custom PDF layouts, and advanced forecasting are outside the MVP.

## 15. Engineering quality and extensibility

### 15.1 Confirmed quality goals

- The software must be easy to extend without destabilising unrelated features.
- The design and implementation must be modular, maintainable, and testable.
- Business rules must behave consistently across dashboard, QR, purchasing, job, and administrative workflows.

### 15.2 Architecture requirements

- Use explicit domain boundaries for Catalogue and Inventory, Locations and Maps, Jobs and Reservations, Allocation and Custody, Purchasing, Identity and Permissions, Notifications, Audit, and Reporting.
- Keep business rules independent of browser screens and infrastructure concerns.
- Begin with a well-structured modular application rather than operationally complex distributed services; modules communicate through explicit interfaces and domain events.
- Enforce module dependency rules automatically and document important architecture decisions.
- Treat extension points, configuration, and external integrations as stable interfaces rather than scattering customer-specific conditions through the code.
- Use typed contracts and versioned interfaces for external APIs and imports/exports.
- Test domain rules with fast unit tests; persistence and module collaboration with integration tests; and critical user journeys with browser-level end-to-end tests.
- Critical tests cover concurrent stock changes, permission enforcement, QR retry safety, reservation expiry, pack conversion, partial collection, reconciliation, reversals, purchasing receipt, and MFA.
- Every database change uses a reviewed, tested migration with a safe upgrade and recovery path.
- Automated quality gates include formatting, static analysis, type checking, tests, security scanning, and build verification.
- Production releases are traceable and observable through structured logs, health checks, metrics, and actionable error monitoring.
- No customer-specific fork should be required for ordinary configuration or permissions.

### 15.3 GitHub Actions and release gates

- The repository uses a protected main branch. Changes arrive through pull requests rather than direct pushes.
- Every pull request and protected-branch update runs required GitHub Actions workflows.
- Merging is blocked when a required workflow fails.
- The automated **quality** workflow performs a clean locked dependency installation, formatting check, linting with no warnings, type checking, and production build.
- The automated **unit** workflow runs unit tests and publishes a coverage report.
- Business and domain modules target at least 80% line and branch coverage. Critical inventory, reservation, permission, purchasing, and costing invariants require explicit scenario coverage even when the percentage threshold has already been met.
- The automated **integration** workflow uses an isolated real test database and covers atomic stock changes, concurrent collection, QR idempotency, fractional and pack conversions, VAT and money precision, permission enforcement, weighted-average cost, and immutable audit behaviour.
- The automated **end-to-end** workflow covers critical journeys: sign-in and MFA, catalogue creation and receiving, duplicate prevention, inventory search, location setup, reservation approval and partial collection, issue and consumption, reusable-tool custody transfer, job closeout, stocktake adjustment, purchase order and invoice matching, permission override, report export, and privileged override.
- Automated checks scan dependencies and the repository for known high-severity vulnerabilities and committed secrets.
- Core pages receive automated accessibility checks, supplemented by manual keyboard and responsive-layout smoke testing before release.
- Database migrations are tested from both an empty database and the previous supported release schema.
- A production release uses the exact commit that passed the workflows, receives explicit vendor approval, creates a pre-release backup, runs post-deployment health checks, and retains a documented recovery route.
- Tests must be deterministic, runnable locally, and structured so a failure identifies the affected module or workflow.

## 16. MVP boundary and outcome evaluation

### 16.1 Explicitly deferred

The following are not required for the approved MVP:

- multiple business branches or a shared multi-customer application instance;
- native desktop or mobile applications and offline operation;
- company single sign-on;
- automatic supplier ordering or payment execution;
- general-ledger, banking, payroll, customer-invoicing, job-revenue, labour-cost, or profitability features;
- direct accounting, supplier, customer, or bank integrations;
- automated supplier email delivery or electronic ordering;
- multi-currency purchasing;
- a full budgeting module;
- tool calibration, scheduled servicing, maintenance management, repair-invoice tracking, depreciation, or statutory capital-asset accounting;
- building- and bin-scoped user permissions;
- precise-scale maps, route planning, or visual job-site and van maps;
- map version history and graphical undo beyond ordinary audited edits;
- proprietary printer-driver integration and location QR labels;
- CSV import of users, existing custody assignments, and open purchase orders;
- custom, scheduled, or emailed reports, custom report/PDF designers, and advanced forecasting;
- formal training assessment, certification, or permission-gated training;
- automated fraud or behavioural monitoring;
- enterprise availability commitments, multi-region hosting, or formal security and accessibility certification.

### 16.2 MVP outcome evaluation

- StockControl records the actor for 100% of stock-changing actions as a system invariant.
- Each pilot customer establishes a baseline for time spent receiving, finding, issuing, moving, reconciling, and ordering stock.
- The product records stocktake accuracy, adjustment frequency, stockouts, projected shortages, duplicate requests, emergency purchases, dead stock, and material waste so improvement can be assessed.
- Initial success is a demonstrable reduction in administrative time and avoidable purchasing without dependence on parallel spreadsheets. Numeric commercial targets are set after observing the first customer baseline rather than being contractual MVP requirements.

## 17. Informative valuation and VAT policy basis

This section explains the policy basis used to shape the product requirements. It is informative rather than a claim of accounting compliance, tax advice, or certification. The operational model is designed to be compatible with, but not a substitute for, the customer’s statutory accounting policy. It draws on:

- [FRC FRS 102, Section 13 Inventories](https://www.frc.org.uk/library/standards-codes-policy/accounting-and-reporting/uk-accounting-standards/frs-102/), including purchase-cost components, specific identification, weighted-average costing, and inventory impairment; and
- [HMRC guidance on keeping VAT records](https://www.gov.uk/charge-reclaim-record-vat/keeping-vat-records), including received invoices, debit and credit notes, net/VAT/gross records, digital records, corrections, and retention.

Each customer should confirm its VAT recovery, capitalisation, impairment, and accounting-integration settings with its accountant during setup.

## 18. Approved MVP acceptance

The MVP requirements are accepted as complete when all of the following are true:

- A dedicated customer installation can be configured from an empty database without requiring an import.
- Admin, Office, and Engineer users can complete the authorised catalogue, receiving, inventory, location, map, job, reservation, allocation, custody, purchasing, stocktake, notification, audit, and reporting workflows defined in this document.
- Quantities, serialized assets, units and pack conversions, fractional stock, multiple locations, reservations, job-site stock, van stock, and reusable tools obey the stated availability, custody, and costing rules under concurrent use.
- QR labels and scanning support the approved item, asset, reservation, allocation, and job-collection journeys, including authentication, authorisation, and duplicate-submission protection.
- Role templates, individual permission changes, separation-of-duties rules, safeguards, and reasoned overrides are enforced and audited as specified.
- The seven locked reports, printable views, CSV exports, purchase-order PDFs, QR-label PDFs, documentation, setup wizard, and optional supported CSV imports are available.
- Backup and restore have been tested, the supported browser and responsive-layout checks have passed, and every required GitHub Actions quality gate is green for the release commit.
- No feature listed in section 16.1 is required to accept or launch the MVP.

This document is the approved requirements baseline for implementation. Any later change to an approved requirement, acceptance condition, or MVP boundary must be recorded as an explicit revision rather than silently changing the baseline.
