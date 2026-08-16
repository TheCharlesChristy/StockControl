import type { UserRole } from "@stockcontrol/contracts";

export interface PageHelpStep {
  readonly title: string;
  readonly body: string;
  /** A CSS selector for the live control or region this step demonstrates. */
  readonly target?: string;
  readonly targetLabel?: string;
}

export interface PageHelpContent {
  readonly title: string;
  readonly intro: string;
  readonly steps: readonly PageHelpStep[];
}

const content = (
  title: string,
  intro: string,
  steps: readonly PageHelpStep[],
): PageHelpContent => ({ title, intro, steps });

const guidedStep = (
  title: string,
  body: string,
  target?: string,
  targetLabel?: string,
): PageHelpStep => {
  return {
    title,
    body,
    ...(target === undefined ? {} : { target }),
    ...(targetLabel === undefined ? {} : { targetLabel }),
  };
};

const genericContent = content(
  "Using this page",
  "Use the highlighted part of the page as your starting point.",
  [
    guidedStep(
      "Start with the control highlighted above",
      "Use the search, filter, link, or button highlighted on the page. The control stays available while this guide is open, so you can try it before moving on.",
    ),
    guidedStep(
      "Use links to move through a workflow",
      "Item references, job numbers, and people’s names open their detail pages. Follow the link when you need to inspect a record or complete its next action.",
    ),
    guidedStep(
      "Report a problem from the page",
      "If a control is missing or an action fails, close this guide and choose Report an issue in the top bar. Include what you expected and what happened.",
    ),
  ],
);

export function pageHelpFor(path: string, role?: UserRole): PageHelpContent {
  if (path === "/sign-in") {
    return content(
      "Sign in",
      "Enter the credentials supplied by your StockControl administrator.",
      [
        guidedStep(
          "Type your username",
          "Select the Username field and enter the name supplied by your Admin. StockControl checks the format before it sends the sign-in request.",
          "#username",
          "Username field",
        ),
        guidedStep(
          "Type your password",
          "Select Password and enter your password. Use the eye button inside the field if you need to check the text before submitting.",
          "#password",
          "Password field",
        ),
        guidedStep(
          "Submit the form",
          "Select Sign in once both fields are complete. A successful sign-in opens Overview, or returns you to the item or job link you were trying to open.",
          "button[type=submit]",
          "Sign in button",
        ),
      ],
    );
  }

  if (path === "/dashboard") {
    if (role === "Engineer") {
      return content(
        "Your Overview",
        "Use the highlighted sections to find stock, work, and your outstanding requests.",
        [
          guidedStep(
            "Search the stock you can use",
            "Type an item name, code, barcode, or part number into Search inventory. Open the item code in a result to see its stock operations.",
            '[data-help-target="dashboard-engineer-stock"]',
            "Stock table and search",
          ),
          guidedStep(
            "Open one of your jobs",
            "Select a job number under Your jobs. Its detail page shows commitments and lets you collect reserved stock to the job site.",
            '[data-help-target="dashboard-engineer-jobs"]',
            "Your jobs",
          ),
          guidedStep(
            "Check what still needs attention",
            "Stock committed for you lists quantities still waiting to be collected. Your stock requests lists requests you have raised and their decisions.",
            '[data-help-target="dashboard-engineer-requests"]',
            "Your commitments and requests",
          ),
        ],
      );
    }

    return content(
      "Overview",
      "Use Overview as your queue for shortages, requests, jobs, and recent movement.",
      [
        guidedStep(
          "Read the headline counts",
          "Items in catalogue is the number of item records. Open jobs and Open commitments count current work. Requests waiting is the number of requests needing a decision.",
          '[data-help-target="dashboard-stats"]',
          "Overview counts",
        ),
        guidedStep(
          "Review a request",
          "Select Review requests when the warning appears, or See all in Stock requests. Approve the quantity you can provide, or reject with a reason.",
          '[data-help-target="dashboard-requests"]',
          "Stock requests panel",
        ),
        guidedStep(
          "Open the work record",
          "Select a job number in Jobs coming up to reserve stock, assign people, or check what has already reached the site.",
          '[data-help-target="dashboard-jobs"]',
          "Jobs coming up",
        ),
      ],
    );
  }

  if (path === "/inventory") {
    return content(
      "Inventory",
      "Find an item, inspect its locations, then open or export the result you need.",
      [
        guidedStep(
          "Search the catalogue",
          "Enter an item name, code, barcode, or part number in Search inventory. The list refreshes as you type and keeps the result count paginated.",
          '[data-help-target="inventory-search"]',
          "Search inventory",
        ),
        guidedStep(
          "Expand a row to see locations",
          "Use the arrow at the start of a row. The location breakdown loads only when you open it. Ready to use means store stock minus open commitments.",
          '[data-help-target="inventory-results"]',
          "Inventory results",
        ),
        guidedStep(
          "Open, create, or export",
          "Select an item code to open its detail page. Office and Admin users can use New item to add a catalogue record or Export CSV to download the current search.",
          '[data-help-target="inventory-actions"]',
          "Inventory actions",
        ),
      ],
    );
  }

  if (path === "/stock-capture") {
    return content(
      "Add stock",
      "One delivery at a time: photograph whatever you cannot scan, check what StockControl made of it, then confirm the quantity and where it went.",
      [
        guidedStep(
          "Set where the delivery is going",
          "Choose the store once for the whole batch. Each item starts from that store, and you can still change it for any single item.",
        ),
        guidedStep(
          "Photograph an item",
          "This opens the same scan sheet as the round button on every other screen. Take up to five photographs, or choose ones you already have. They are read on your device first, so a readable barcode identifies the item without anything being sent.",
        ),
        guidedStep(
          "Choose whether to send them",
          "Nothing leaves your device until you select Send this photo to be identified. Only Office and Admin users are offered that, and only where your administrator has turned assisted capture on.",
        ),
        guidedStep(
          "Check the suggestion",
          "The best match is marked. Strong, Possible and Weak describe how much the evidence supports each one. Show analysis details lists what was checked for every photograph. Choose None are correct to type the item in yourself.",
        ),
        guidedStep(
          "Confirm the receipt",
          "Enter the quantity and confirm the store. Nothing changes in stock until you select Confirm receipt, and the next screen shows the item's reference and its new balance.",
        ),
      ],
    );
  }

  if (path.startsWith("/inventory/")) {
    return content(
      "Item details",
      "Use this record to check stock, perform an allowed movement, and trace the result.",
      [
        guidedStep(
          "Read before moving stock",
          "Check the stock summary and the Stock by location table before choosing an operation. Reserved stock is committed to jobs; Ready to use is what remains available in stores.",
          '[data-help-target="item-stock-balances"]',
          "Stock summary and locations",
        ),
        guidedStep(
          "Choose the operation that matches the movement",
          role === "Engineer"
            ? "Use Take from store when you are taking stock for your work, or Request stock when you need the Office team to provide more. Reserve and collect belong on a job page."
            : "Use Receive for incoming stock, Take from store for an issue, and More actions for a store transfer, counted correction, item edit, or archive.",
          role === "Engineer"
            ? '[data-help-target="item-take"]'
            : '[data-help-target="item-receive"]',
          role === "Engineer" ? "Take from store / Request stock" : "Receive stock",
        ),
        guidedStep(
          "Trace and identify the item",
          "Show on map opens the storage map. The Scan panel contains the QR code or barcode for this item; Print label prints it. See the full log opens the transaction history.",
          '[data-help-target="item-scan"]',
          "Scan and print label panel",
        ),
      ],
    );
  }

  if (path === "/jobs") {
    return content("Jobs", "Filter the work list, then open a job to handle its stock.", [
      guidedStep(
        "Search and filter the list",
        "Search by job number, name, or customer. Use Open, Closed, or All, and use Assigned to me when you only need your own work.",
        '[data-help-target="jobs-filters"]',
        "Job search and filters",
      ),
      guidedStep(
        "Open the job record",
        "Select a job number in the table. The detail page shows assignees, commitments, stock at site, and activity.",
        '[data-help-target="jobs-results"]',
        "Jobs table",
      ),
      guidedStep(
        role === "Engineer" ? "Ask for missing work" : "Create a job when work is confirmed",
        role === "Engineer"
          ? "Engineers can view and work on jobs but cannot create them. Ask an Office or Admin user to create the job and assign you."
          : "Select New job, enter Job name and Customer, then select Create job. StockControl creates the job number and job-site location automatically.",
        role === "Engineer" ? undefined : '[data-help-target="jobs-new"]',
        role === "Engineer" ? undefined : "New job",
      ),
    ]);
  }

  if (path.startsWith("/jobs/")) {
    return content(
      "Job details",
      "Follow the job from assignment to reservation, collection, and close.",
      [
        guidedStep(
          "Check status and assignees",
          role === "Engineer"
            ? "Read the status and stock counts, then check that you are assigned to the job. Ask Office or Admin users to change assignments."
            : "Use the Assignees panel to add or remove active team members. Assigned people see the job on their Overview.",
          '[data-help-target="job-summary"]',
          "Job status and summary",
        ),
        guidedStep(
          "Reserve stock for the job",
          "Select Reserve for this job, choose an item, enter the quantity, and submit. Reservation commits available store stock but does not move it yet.",
          '[data-help-target="job-reserve"]',
          "Reserve for this job",
        ),
        guidedStep(
          "Collect or release each commitment",
          "In Stock committed to this job, select Collect to site to move stock from a store to the job site. Collection can be partial and repeated; Release remaining makes the uncollected quantity available again.",
          '[data-help-target="job-reservations"]',
          "Reservations table",
        ),
        ...(role === "Engineer"
          ? []
          : [
              guidedStep(
                "Close the job when work is complete",
                "Select Close job and confirm. Any uncollected commitment is released; stock already at the job site stays there and remains visible in the job record.",
                '[data-help-target="job-close"]',
                "Close job",
              ),
            ]),
      ],
    );
  }

  if (path === "/requests") {
    if (role === "Engineer") {
      return content(
        "Stock requests",
        "Engineers raise requests from an item page; Office and Admin users make the decision here.",
        [
          guidedStep(
            "Raise a request from an item",
            "Open an item detail page and select Request stock. Enter the quantity and, if relevant, the job it is for. Your request appears in Your stock requests on Overview.",
          ),
          guidedStep(
            "Ask an authorised user to review it",
            "Office and Admin users can approve an amount, reserve it for a named job, or reject it with a reason. Contact them if the request is still waiting.",
          ),
        ],
      );
    }

    return content(
      "Stock requests",
      "Review waiting requests and record the decision that matches the stock you can provide.",
      [
        guidedStep(
          "Choose the queue to review",
          "Status starts at Waiting. Choose Approved, Rejected, Withdrawn, or All requests when you need to inspect previous decisions.",
          '[data-help-target="requests-status"]',
          "Status filter",
        ),
        guidedStep(
          "Approve only what you can provide",
          "On a waiting request, select Approve, check or amend Quantity to approve, add an optional note, and confirm. A named job becomes a reservation.",
          '[data-help-target="requests-list"]',
          "Request list and decisions",
        ),
        guidedStep(
          "Reject with a reason when needed",
          "Select Reject when the request cannot be fulfilled. Enter a reason so the requester knows what decision was made and why.",
          '[data-help-target="requests-list"]',
          "Request list and decisions",
        ),
      ],
    );
  }

  if (path === "/transactions") {
    return content(
      "Transactions",
      "Filter the audit log to find a movement, then export the filtered results if needed.",
      [
        guidedStep(
          "Set the filters you need",
          "Filter by item, action, and—where available—person. Enter From date and To date as dd/mm/yyyy, or use Today and Last 7 days.",
          '[data-help-target="transactions-filters"]',
          "Transaction filters",
        ),
        guidedStep(
          "Read a movement row",
          role === "Engineer"
            ? "Your view contains movements you made. Read Action, Quantity, From, To, Job, and Reason to understand what changed."
            : "The audit view includes who made the change as well as Action, Quantity, From, To, Job, and Reason.",
          '[data-help-target="transactions-results"]',
          "Transaction results",
        ),
        guidedStep(
          "Export the filtered log",
          "Select Export CSV to download all rows matching the item, action, person, and date filters. Transactions cannot be edited or deleted; correct a mistake with a new movement.",
          '[data-help-target="transactions-export"]',
          "Export CSV",
        ),
      ],
    );
  }

  if (path === "/locations") {
    return content(
      "Locations",
      "Use the list and map together to find a storage location or edit the layout if you are an Admin.",
      [
        guidedStep(
          "Find a location",
          "Type at least part of a code, name, or alias into Search locations. Select a result or a shape on the map to inspect it.",
          '[data-help-target="locations-search"]',
          "Search locations",
        ),
        guidedStep(
          "Select the right map tool",
          role === "Admin"
            ? "Select the rectangle or polygon drawing tool, draw the location on the map, then open its details to set its name and code."
            : "Use the map to inspect locations. The View only indicator means your role cannot draw, move, or save map changes.",
          role === "Admin"
            ? '[data-help-target="locations-drawing-tools"]'
            : '[data-help-target="locations-map"]',
          role === "Admin" ? "Drawing tools" : "Map canvas",
        ),
        guidedStep(
          role === "Admin" ? "Save or revert the layout" : "Use the location details",
          role === "Admin"
            ? "After drawing or moving locations, check for rule violations. Select Save to publish the map, or Revert to discard unsaved changes."
            : "Select a location in the list or map, then open its details to see its code, stock status, and position in the map hierarchy.",
          role === "Admin"
            ? '[data-help-target="locations-save"]'
            : '[data-help-target="locations-map"]',
          role === "Admin" ? "Save map" : "Map and location list",
        ),
      ],
    );
  }

  if (path === "/team") {
    if (role !== "Admin") {
      return content("Team & access", "Account access is managed by Admin users.", [
        guidedStep(
          "Ask an Admin to make an access change",
          "An Admin manages accounts, roles, and access. If a section or action is missing, ask an Admin to review your account rather than using someone else’s credentials.",
        ),
        guidedStep(
          "Keep your sign-in private",
          "Use only your own username and password. Every stock movement is recorded against the person who performed it.",
        ),
      ]);
    }

    return content(
      "Team & access",
      "Find a person, update access, and preserve the history attached to their account.",
      [
        guidedStep(
          "Find a person",
          "Search by name, username, email, or role. Select a person’s name to open the account and review their work.",
          '[data-help-target="team-search"]',
          "Team search",
        ),
        guidedStep(
          "Create a user when they need access",
          "Select New user, enter Username, Name, Role, and Initial password, then select Create user. A work email is optional. Give the initial password to the person securely.",
          '[data-help-target="team-new-user"]',
          "New user",
        ),
        guidedStep(
          "Change access deliberately",
          "Use the role selector or Active switch in the table, review the confirmation dialog, and confirm. You cannot disable yourself; disable accounts with history instead of deleting them.",
          '[data-help-target="team-results"]',
          "Team table",
        ),
      ],
    );
  }

  if (path.startsWith("/team/")) {
    return content(
      "User details",
      "Use the account form and activity panels to understand and manage one person.",
      [
        guidedStep(
          "Update account details",
          role === "Admin"
            ? "Edit Username, Work email, Name, Role, or Account is active, then select Save changes. Emptying the email removes it. You cannot change your own role or disable yourself."
            : "This page is Admin-only. Ask an Admin to update account details or review a colleague’s activity.",
          role === "Admin" ? '[data-help-target="user-details-form"]' : undefined,
          role === "Admin" ? "Details form" : undefined,
        ),
        guidedStep(
          "Review the person’s work",
          "Recent activity shows stock movements. Open reservations shows committed, collected, and outstanding quantities. Stock requests shows their demand.",
          '[data-help-target="user-activity"]',
          "Activity and reservations",
        ),
        guidedStep(
          "Open the filtered audit log",
          "Select See the full log to open Transactions filtered to this person. Delete account is only available when no stock activity exists; otherwise disable the account.",
          '[data-help-target="user-full-log"]',
          "See the full log",
        ),
      ],
    );
  }

  if (path === "/profile") {
    return content(
      "Profile",
      "Change the photo shown beside your name; account identity and role are managed by an Admin.",
      [
        guidedStep(
          "Choose a profile photo",
          "Select Choose photo, pick a PNG or JPEG, and wait for the saved confirmation. The new photo appears in the navigation and team records.",
          '[data-help-target="profile-photo"]',
          "Choose photo",
        ),
        guidedStep(
          "Remove a photo if needed",
          "Select Remove to return to your initials. Your username, work email, name, and role cannot be changed on this page.",
          '[data-help-target="profile-remove"]',
          "Remove photo",
        ),
      ],
    );
  }

  if (path === "/loading") {
    return content("Loading", "The page is waiting for data from StockControl.", [
      guidedStep(
        "Wait for the page to finish",
        "Keep the page open while the loading indicator is visible. Do not submit the same action repeatedly while a button is busy.",
      ),
      guidedStep(
        "Retry or return to Overview",
        "If loading does not finish, select Try again when available. If the problem continues, return to Overview and open the page again.",
        '[role="alert"]',
        "Page status",
      ),
    ]);
  }

  if (path === "/error") {
    return content(
      "Application error",
      "The page could not complete its request; a loading error does not change stock.",
      [
        guidedStep(
          "Try the page request again",
          "Select Try again on the error message when it is available. If the request succeeds, the page will reload its data.",
          '[role="alert"]',
          "Error message and retry",
        ),
        guidedStep(
          "Report a repeated problem",
          "Return to a working page and select Report an issue in the top bar. Include the page, the action you took, and the error text.",
        ),
      ],
    );
  }

  if (path === "/not-found" || path === "*") {
    return content("Page not found", "This address does not match a StockControl page or record.", [
      guidedStep(
        "Return to a known page",
        "Use Overview or the navigation drawer, then search for the item, job, or person again instead of editing the address manually.",
      ),
      guidedStep(
        "Check the link",
        "If someone sent you the link, ask them to confirm it. A missing page does not change inventory or job stock.",
      ),
    ]);
  }

  return genericContent;
}
