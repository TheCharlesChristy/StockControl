# **Software Requirements Specification (SRS)**

## **Stock Management & Location Tracking System**

Version: 1.0
Audience: Engineering team (frontend, backend, QA, product)

---

# **1. Purpose & Scope**

The goal of this system is to give a trade company a **modular, extensible platform** for tracking:

* Stock quantities
* Locations (warehouses, vans, bins, shelves, buildings)
* Stock movements (incoming, outgoing, reserved, adjusted)
* Supplier details and ordering links
* Barcodes (manufacturer) + internal QR codes
* Users and permissions
* Maps of storage areas
* Stock requests from vans to warehouses

It must run as a **responsive web application** supporting desktop and mobile use.
It will later expand beyond stock management, so the architecture must remain modular.

---

# **2. System Objectives**

The system must:

1. Track exact or approximate stock levels depending on item type.
2. Assign stock to arbitrary locations.
3. Treat vans as normal locations.
4. Provide easy scanning (barcode + QR).
5. Allow low-skill staff to use it confidently (“idiot-proof”), while still offering depth.
6. Provide full audit logging (who changed what and when).
7. Support a strong permission system.
8. Offer maps for visual navigation.
9. Be extensible for future modules.
10. Offer a clean external API for integration.

---

# **3. Key Features (Overview)**

### **3.1 Stock Item Management**

* Create/edit items
* Store name, SKU, category, description, photos
* Store minimum stock levels
* Support multiple suppliers per item
* Dimensions optional (length, width, height, weight)
* Internal QR codes + manufacturer barcodes
* Unit types:

  * `unit`
  * `meter`
  * `kg`
  * `litre`
  * `box`
  * `flexi` (approximate)
* Unit conversions optional

### **3.2 Locations**

* Hierarchical model (site → building → zone → shelf → bin, etc.)
* Vans are locations in the hierarchy (site → fleet → van)
* Each location can contain stock
* Support sub-locations like drawers, compartments, etc.

### **3.3 Maps**

* Vector-based map editor
* Draw shapes and assign each shape to a location
* Clickable map to view stock in that area
* Search item → highlight storage locations on the map

### **3.4 Stock Movements**

* Receive
* Reserve
* Issue
* Adjust
* Transfer
* Return
* Flexi-item approximations
* Everything logged with:

  * User
  * Timestamp
  * Location(s)
  * Job number (optional)
  * Notes (optional)

### **3.5 Stock Requests (Van → Warehouse)**

* Engineers request stock
* Warehouse approves or rejects
* Approval automatically creates movements
* Tracks requested, approved, and delivered quantities

### **3.6 Permissions**

Granular permission toggles:

* View stock
* Edit items
* Adjust quantities
* Manage users
* Manage roles
* Manage locations
* Manage maps
* Create movements
* Approve stock requests
* View cost values
  (and more defined in API spec)

### **3.7 Notifications**

* Low stock alerts
* Movement notifications
* Stock request approvals/rejections
* System notifications (optionally)

### **3.8 Reporting**

* Valuation
* Movement history
* Usage per job
* Location-level reporting

---

# **4. Detailed Functional Requirements**

## **4.1 User & Authentication Requirements**

### **4.1.1 Login**

* Authenticate via username + password
* JWT authentication with access + refresh tokens
* Password rules configurable (length, complexity)

### **4.1.2 Roles & Permissions**

* Every user belongs to one or more roles
* Each role is a permissions bundle
* Admin can:

  * Create/edit/delete roles
  * Assign roles to users
  * Override permissions per user
* All permissions enforced server-side

### **4.1.3 Admin**

* Root admin account cannot be removed
* Always holds all permissions

---

## **4.2 Items & Stock**

### **4.2.1 Item Creation**

Users with permission can create items with:

* Name
* SKU
* Category
* Description
* Photos
* Supplier list
* Unit type
* Min stock level
* Optional dimensions

### **4.2.2 Multi-Code Identification**

Each item may have:

* Multiple barcodes (manufacturer)
* Multiple QR codes (internal)

Both must map to the same item.

### **4.2.3 Stock Levels**

System must track:

* Total quantity
* Available
* Reserved
* On order
* Breakdown by location

### **4.2.4 Stock for Flexi-Items**

These items use:

* Approximate amounts
* “Percent full”, “container fraction”, or manual estimate
* System converts estimate to numeric quantity
* Movement logged with `approximate = true`

---

## **4.3 Locations**

### **4.3.1 Hierarchy**

Locations form a tree:

```
Site → Warehouse → Aisle → Shelf → Bin
Site → Fleet → Van → Drawer → Compartment
```

### **4.3.2 Location Properties**

* Name
* Code
* Type (warehouse, van, bin, etc.)
* Parent ID

### **4.3.3 Van-Specific Behaviour**

* Engineers assigned to vans may manage only their van
* Vans may have minimum levels per item
* Vans can issue stock requests

---

## **4.4 Maps**

### **4.4.1 Map Editor**

Users may:

* Create maps
* Draw vector shapes
* Assign shapes to locations
* Set fill/stroke
* Move and resize shapes

### **4.4.2 Map Viewer**

Users may:

* View a location by clicking a shape
* Highlight item locations
* Zoom/pan

---

## **4.5 Movements**

### **4.5.1 Movement Data**

Each movement must include:

* Item ID
* From location
* To location
* Quantity (approximation flag optional)
* Unit type
* Notes
* Job number (optional)
* Timestamp
* User

### **4.5.2 Movement Types**

* Receive
* Issue
* Reserve
* Adjust
* Transfer
* Return

Movement validation rules:

* Can’t issue more than available
* Reservations reduce availability but not total
* Adjustments marked as such

---

## **4.6 Stock Requests (Van → Warehouse)**

### **4.6.1 Creating Requests**

Fields:

* Item
* Quantity
* Unit type
* Job number (optional)
* Notes

### **4.6.2 Reviewing**

Warehouse staff may:

* Approve
* Part approve
* Reject

Approvals generate stock movements automatically.

---

## **4.7 Notifications**

Types:

* Movement alerts
* Low stock alerts
* Stock request updates
* System alerts

Notifications must be filterable and dismissible.

---

## **4.8 Reporting**

### **4.8.1 Valuation**

* Calculates value based on:

  * Unit cost
  * Applicable quantities

### **4.8.2 Movement Report**

* Filter by:

  * Date range
  * Item
  * Location
  * User
  * Movement type

### **4.8.3 Usage Report**

* Consumption grouped by job
* Per item
* Per location

---

# **5. Non-Functional Requirements**

## **5.1 Performance**

* API responses < 300 ms typical
* Search < 500 ms for up to 10k items
* QR and barcode scanning must resolve in < 200 ms

## **5.2 Scalability**

* Must support:

  * 100k+ movements
  * 10k+ items
  * 50+ concurrent users

## **5.3 Reliability**

* Nightly backups
* Automatic retry for failed writes
* Graceful error recovery

## **5.4 Security**

* HTTPS enforced
* RBAC
* Audit logs for all sensitive actions
* Encrypted passwords (bcrypt or Argon2)

## **5.5 Extensibility**

* API-first design (as specified in OpenAPI)
* Modular service design so new features can be added
* Data model flexible enough for:

  * Tool management
  * Vehicle tracking
  * Purchase orders
  * Asset maintenance
  * Timesheets

---

# **6. System Architecture Requirements**

## **6.1 Frontend**

* React + TypeScript
* TailwindCSS
* React Query
* zxing-js for barcode/QR scanning
* Konva.js or Fabric.js for map editor

## **6.2 Backend**

* Python (FastAPI or Flask)
* PostgreSQL
* SQLAlchemy ORM
* Redis (caching + notifications queue)
* JWT authentication
* Pydantic for schema validation
* Clean module structure:

  * `items/`
  * `locations/`
  * `maps/`
  * `movements/`
  * `stock-requests/`
  * `notifications/`
  * `users/roles/auth/`

## **6.3 API**

* Fully specified in the OpenAPI 3.1 YAML
* Versioned at `/api/v1`
* Strict RBAC enforcement

---

# **7. Data Model (Summary)**

Core tables/collections:

* Users
* Roles
* Permissions
* Items
* ItemCodes
* ItemSuppliers
* Locations
* Maps
* Movements
* StockRequests
* Notifications

Each entity is defined in the OpenAPI spec.

---

# **8. Workflow Descriptions**

## **8.1 Receiving Stock**

1. User scans code
2. If unknown: prompt to link/create item
3. Enter quantity
4. Select location
5. Movement logged

## **8.2 Issuing Stock**

1. Scan or search
2. Select issue
3. Enter quantity
4. Add job number
5. Movement logged

## **8.3 Adjusting Flexi-Item**

1. Open flexi adjustment
2. Enter approximate amount or percent
3. System calculates estimated number
4. Movement logged (`approximate = true`)

## **8.4 Van Stock Request**

1. Engineer opens “Request Stock”
2. Submit request
3. Warehouse reviews
4. Approval triggers movement

---

# **9. Constraints**

* Must run on mobile and desktop
* Must not rely on hardware-specific scanners
* Must avoid introducing RFID/NFC (future optional)
* Must not auto-generate purchase orders (yet)

---

# **10. Future Feature Hooks**

System must keep a pathway open for:

* Full purchase order module
* Tool tracking
* Van usage logs
* Asset maintenance
* Time tracking
* HR/job scheduling
* Barcode → supplier reconciliation
* Integration with Commusoft and Xero

---

# **11. Acceptance Criteria (High-Level)**

1. Users can create/edit items.
2. Users can scan barcodes/QRs to find or create items.
3. Users can move stock between any two locations.
4. Vans function exactly like warehouses.
5. Maps can be created and used for navigation.
6. Flexi-items allow approximate counting.
7. All actions appear in audit logs.
8. Permissions limit user access correctly.
9. Notifications fire under correct conditions.
10. System remains responsive under load.